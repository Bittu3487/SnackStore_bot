import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
}));

// ─────────────────────────────
// ENV
// ─────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API_KEY = process.env.API_KEY;

// ─────────────────────────────
// 🛒 CATEGORY-BASED MENU (FUTURE EXPAND EASY)
// ─────────────────────────────
const menu = {
  chocolates: {
    dairy_milk: 40,
    five_star: 20,
    kitkat: 20,
  },

  biscuits: {
    parle_g: 10,
    oreo: 30,
    good_day: 25,
  },

  cold_drinks: {
    pepsi: 40,
    coca_cola: 40,
    frooti: 20,
  },

  namkeen: {
    lays: 20,
    bingo: 25,
    kurkure: 20,
  },

  noodles: {
    maggi: 15,
    yippee: 20,
  },

  spicy: {
    chaat_papdi: 25,
    sev: 20,
  },
  
};


app.get("/", (req, res) => {
  res.send("SnackBot Backend Running 🚀");
});

// ─────────────────────────────
// SESSION STORE
// ─────────────────────────────
const sessions = {};

// ─────────────────────────────
// TELEGRAM
// ─────────────────────────────
const sendTelegram = async (msg) => {
  if (!TELEGRAM_TOKEN || !CHAT_ID) return;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg }),
    });
  } catch (e) {
    console.log("Telegram error");
  }
};

// ─────────────────────────────
// ORDER PARSER (CATEGORY SUPPORT)
// ─────────────────────────────
const extractOrder = (message) => {
  let items = [];
  let total = 0;

  for (const category in menu) {
    for (const item in menu[category]) {
      const price = menu[category][item];

      const regex = new RegExp(`(\\d+)\\s*${item}`, "i");
      const match = message.match(regex);

      if (match) {
        const qty = parseInt(match[1]);
        items.push({ category, name: item, qty, price });
        total += qty * price;
      } else if (new RegExp(item, "i").test(message)) {
        items.push({ category, name: item, qty: 1, price });
        total += price;
      }
    }
  }

  return { items, total };
};

// ─────────────────────────────
// AI fallback (optional gemini)
// ─────────────────────────────
const callGemini = async (sessionId, userMessage) => {
  const session = sessions[sessionId];

  const history = session.history || [];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: userMessage }],
          },
        ],
      }),
    }
  );

  const data = await response.json();
  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "Samajh nahi aaya 🤔"
  );
};

// ─────────────────────────────
// MAIN API
// ─────────────────────────────
app.post("/ai", async (req, res) => {
  try {
    const userMessage = (req.body.message || "").toLowerCase().trim();
    const sessionId = req.body.sessionId || "default";

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        step: "welcome",
        category: null,
        order: {},
        awaitingDetails: false,
      };
    }

    const session = sessions[sessionId];

    // ─────────────────────────
    // 1. FIRST WELCOME ONLY ONCE
    // ─────────────────────────
    if (session.step === "welcome") {
      session.step = "choose_category";

      return res.json({
        type: "welcome",
        reply: `👋 Hello! Main SnackBot hoon 🍟

👉 Category choose karo:

🍫 chocolates
🍪 biscuits
🥤 cold_drinks
🌶️ namkeen
🍜 noodles
🔥 spicy`
      });
    }

    // ─────────────────────────
    // 2. CATEGORY SELECT
    // ─────────────────────────
    for (const cat in menu) {
      if (userMessage.includes(cat)) {
        session.category = cat;

        const items = Object.keys(menu[cat])
          .map((i) => `${i} ₹${menu[cat][i]}`)
          .join("\n");

        return res.json({
          type: "menu",
          reply: `🍽️ ${cat.toUpperCase()} MENU:

${items}

👉 Example: "2 ${Object.keys(menu[cat])[0]}"`
        });
      }
    }

    // ─────────────────────────
    // 3. SHOW MENU
    // ─────────────────────────
    if (userMessage.includes("menu")) {
      return res.json({
        type: "menu",
        reply: `🍟 Available Categories:

🍫 chocolates
🍪 biscuits
🥤 cold_drinks
🌶️ namkeen
🍜 noodles
🔥 spicy`,
      });
    }

    // ─────────────────────────
    // 4. ORDER DETECT
    // ─────────────────────────
    const { items, total } = extractOrder(userMessage);

    if (items.length > 0) {
      session.order = { items, total };

      const list = items.map((i) => `${i.name} x${i.qty}`).join(", ");

      return res.json({
        type: "order",
        reply: `🛒 Order:

${list}
💰 Total: ₹${total}

Confirm karo?`,
      });
    }

    // ─────────────────────────
    // 5. CONFIRM ORDER
    // ─────────────────────────
    if (
      userMessage.includes("confirm") ||
      userMessage.includes("yes") ||
      userMessage.includes("haan")
    ) {
      session.awaitingDetails = true;

      return res.json({
        type: "confirm",
        reply: `📦 Send details:

Name, Mobile, Address, Pincode`,
      });
    }

    // ─────────────────────────
    // 6. FINAL DETAILS
    // ─────────────────────────
    if (session.awaitingDetails && userMessage.includes(",")) {
      const [name, mobile, address, pincode] =
        userMessage.split(",");

      session.awaitingDetails = false;

      const itemsText = session.order.items
        .map((i) => `${i.name} x${i.qty}`)
        .join(", ");

      await sendTelegram(`
🛒 NEW ORDER

👤 ${name}
📱 ${mobile}
📍 ${address}
📌 ${pincode}

🧾 Items: ${itemsText}
💰 Total: ₹${session.order.total}
      `);

      session.order = {};

      return res.json({
        type: "success",
        reply: `🎉 Order placed ${name}!

🚚 Delivery coming soon 🍟`,
      });
    }

    // ─────────────────────────
    // 7. FALLBACK AI
    // ─────────────────────────
    const reply = await callGemini(sessionId, userMessage);

    return res.json({
      type: "ai",
      reply,
    });
  } catch (err) {
    console.error(err);
    res.json({
      type: "error",
      reply: "❌ Server error",
    });
  }
});

// ─────────────────────────────
// RESET
// ─────────────────────────────
app.post("/reset", (req, res) => {
  const sessionId = req.body.sessionId || "default";
  sessions[sessionId] = {
    step: "welcome",
    category: null,
    order: {},
    awaitingDetails: false,
  };
  res.json({ success: true });
});

// ─────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 SnackBot running on http://localhost:3000");
});