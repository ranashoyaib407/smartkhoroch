const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

const USERS_COLLECTION = "users";
const DEFAULT_MONTHLY_BUDGET = 20000;
const TIME_ZONE = "Asia/Dhaka";


/* =========================================================
   HELPERS
   ========================================================= */

function getDhakaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }

  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day)
  };
}


function getDhakaMonthBounds(date = new Date()) {

  const { year, month } = getDhakaDateParts(date);

  // Dhaka month শুরু: UTC equivalent
  const start = new Date(
    Date.UTC(year, month - 1, 1) - (6 * 60 * 60 * 1000)
  );

  // পরের মাস শুরু
  const nextMonthDate =
    month === 12
      ? new Date(Date.UTC(year + 1, 0, 1))
      : new Date(Date.UTC(year, month, 1));

  const end = new Date(
    nextMonthDate.getTime() - (6 * 60 * 60 * 1000)
  );

  return {
    start,
    end
  };
}


/* =========================================================
   চলতি মাসের মোট খরচ
   ========================================================= */

async function getMonthlyExpense(uid, now = new Date()) {

  const { start, end } = getDhakaMonthBounds(now);

  const snapshot = await db
    .collection(USERS_COLLECTION)
    .doc(uid)
    .collection("transactions")
    .where("type", "==", "expense")
    .where("createdAt", ">=", start)
    .where("createdAt", "<", end)
    .get();

  let total = 0;

  snapshot.forEach((doc) => {

    const data = doc.data();

    const amount = Number(data.amount || 0);

    if (Number.isFinite(amount)) {
      total += amount;
    }

  });

  return total;
}


/* =========================================================
   SmartKhoroch-এর বর্তমান Safe Daily Spending Logic
   ========================================================= */

function getSafeDaily(monthlyBudget, monthlyExpense, now = new Date()) {

  const budget =
    Number(monthlyBudget) > 0
      ? Number(monthlyBudget)
      : DEFAULT_MONTHLY_BUDGET;

  const expense = Math.max(
    0,
    Number(monthlyExpense || 0)
  );

  const remainingBudget = Math.max(
    0,
    budget - expense
  );

  const { year, month, day } =
    getDhakaDateParts(now);

  // বর্তমান মাসের শেষ দিন
  const lastDay =
    new Date(
      Date.UTC(year, month, 0)
    ).getUTCDate();

  const daysLeft = Math.max(
    1,
    lastDay - day + 1
  );

  return Math.round(
    remainingBudget / daysLeft
  );
}


/* =========================================================
   Notification ON করা ইউজার বের করা
   ========================================================= */

async function getSubscribedUsers() {

  const snapshot = await db
    .collection(USERS_COLLECTION)
    .where("notificationEnabled", "==", true)
    .get();

  return snapshot.docs.map((doc) => ({
    uid: doc.id,
    data: doc.data()
  }));
}


/* =========================================================
   User-এর notification token বের করা
   ========================================================= */

function getUserTokens(userData) {

  const notificationTokens =
    userData.notificationTokens || {};

  const tokens = [];

  Object.values(notificationTokens).forEach((item) => {

    if (typeof item === "string") {

      tokens.push(item);

    } else if (
      item &&
      typeof item.token === "string"
    ) {

      tokens.push(item.token);

    }

  });

  return [...new Set(tokens)];
}


/* =========================================================
   Invalid token পরিষ্কার করা
   ========================================================= */

async function removeInvalidTokens(
  uid,
  invalidTokens
) {

  if (!invalidTokens.length) {
    return;
  }

  const updates = {};

  invalidTokens.forEach((token) => {

    const tokenKey = encodeURIComponent(token);

    updates[
      `notificationTokens.${tokenKey}`
    ] = admin.firestore.FieldValue.delete();

  });

  await db
    .collection(USERS_COLLECTION)
    .doc(uid)
    .set(updates, { merge: true });

}


/* =========================================================
   সকাল ৬টা
   আজকের Dynamic Safe Spending
   ========================================================= */

exports.sendMorningSafeSpendingPersonalized =
  onSchedule(
    {
      schedule: "0 6 * * *",
      timeZone: TIME_ZONE
    },

    async () => {

      logger.info(
        "Morning safe spending notification started."
      );

      const users =
        await getSubscribedUsers();

      const now = new Date();

      let sentUsers = 0;

      for (const user of users) {

        try {

          const userData = user.data;

          const monthlyBudget =
            Number(
              userData.monthlyBudget ||
              DEFAULT_MONTHLY_BUDGET
            );

          const monthlyExpense =
            await getMonthlyExpense(
              user.uid,
              now
            );

          const safeDaily =
            getSafeDaily(
              monthlyBudget,
              monthlyExpense,
              now
            );

          const tokens =
            getUserTokens(userData);

          if (!tokens.length) {
            continue;
          }

          const message = {

            tokens,

            data: {

              title:
                "🌅 আজকের নিরাপদ খরচ",

              body:
                `পরিকল্পনা করে আজ ৳${safeDaily.toLocaleString(
                  "bn-BD"
                )} পর্যন্ত খরচ রাখুন।`,

              url: "/",

              tag:
                "smartkhoroch-morning-safe-spending"

            }

          };

          const response =
            await messaging.sendEachForMulticast(
              message
            );

          sentUsers += 1;

          const invalidTokens = [];

          response.responses.forEach(
            (result, index) => {

              if (
                !result.success &&
                result.error &&
                (
                  result.error.code ===
                    "messaging/registration-token-not-registered" ||

                  result.error.code ===
                    "messaging/invalid-registration-token"
                )
              ) {

                invalidTokens.push(
                  tokens[index]
                );

              }

            }
          );

          await removeInvalidTokens(
            user.uid,
            invalidTokens
          );

        } catch (error) {

          logger.error(
            `Morning notification failed for ${user.uid}`,
            error
          );

        }

      }

      logger.info(
        `Morning notification completed. Users processed: ${sentUsers}`
      );

    }
  );


/* =========================================================
   রাত ৯টা
   আজকের খরচের হিসাব Reminder
   ========================================================= */

exports.sendNightExpenseReminder =
  onSchedule(
    {
      schedule: "0 21 * * *",
      timeZone: TIME_ZONE
    },

    async () => {

      logger.info(
        "Night expense reminder started."
      );

      const users =
        await getSubscribedUsers();

      let sentUsers = 0;

      for (const user of users) {

        try {

          const tokens =
            getUserTokens(user.data);

          if (!tokens.length) {
            continue;
          }

          const message = {

            tokens,

            data: {

              title:
                "🌙 আজকের খরচের হিসাব হয়েছে তো?",

              body:
                "সব খরচ SmartKhoroch-এ লিখে রাখুন। এক মিনিটের অভ্যাস, মাস শেষে অনেক কাজে দেবে।",

              url: "/",

              tag:
                "smartkhoroch-night-expense-reminder"

            }

          };

          const response =
            await messaging.sendEachForMulticast(
              message
            );

          sentUsers += 1;

          const invalidTokens = [];

          response.responses.forEach(
            (result, index) => {

              if (
                !result.success &&
                result.error &&
                (
                  result.error.code ===
                    "messaging/registration-token-not-registered" ||

                  result.error.code ===
                    "messaging/invalid-registration-token"
                )
              ) {

                invalidTokens.push(
                  tokens[index]
                );

              }

            }
          );

          await removeInvalidTokens(
            user.uid,
            invalidTokens
          );

        } catch (error) {

          logger.error(
            `Night notification failed for ${user.uid}`,
            error
          );

        }

      }

      logger.info(
        `Night notification completed. Users processed: ${sentUsers}`
      );

    }
  );
