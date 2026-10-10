// This file is the "back room" of your product.
// It runs on the server, so your secret key stays hidden from visitors.

// ---- Easy settings you can change ----
const MODEL = "gemini-2.5-flash";   // the AI model used
const MAX_IDEA_LENGTH = 200;        // characters allowed per idea
const PER_VISITOR_DAILY_LIMIT = 5;  // generations per visitor per day
const ALL_VISITORS_DAILY_LIMIT = 100; // total per day, protects your free quota
// --------------------------------------

// Simple counters kept in memory. Good enough for a demo.
// (They can reset when the server goes to sleep. A real product would use a database.)
const visitorCounts = new Map();
let totalCount = 0;
let currentDay = new Date().toISOString().slice(0, 10);

function resetIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentDay) {
    currentDay = today;
    visitorCounts.clear();
    totalCount = 0;
  }
}

const INSTRUCTIONS = `You are a helpful product management coach.
The user gives a one-line product idea. Write a short, simple PRD draft.
Use exactly this format, in plain text, with no markdown symbols (no #, no *):

Problem:
(2 sentences)

Target user:
(1 sentence)

Top 3 features:
- (one line)
- (one line)
- (one line)

Success metrics:
- (one line)
- (one line)

Biggest risk:
(one line)

Use simple, everyday language. Do not add anything else.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Please use the Generate button on the page." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "The secret key is not set up yet. Add GEMINI_API_KEY in your hosting settings." });
  }

  // 1. Check the idea
  const idea = String((req.body && req.body.idea) || "").trim();
  if (!idea) {
    return res.status(400).json({ error: "Please type a product idea first." });
  }
  if (idea.length > MAX_IDEA_LENGTH) {
    return res.status(400).json({ error: `Please keep your idea under ${MAX_IDEA_LENGTH} characters.` });
  }

  // 2. Check usage limits
  resetIfNewDay();
  const visitor = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const used = visitorCounts.get(visitor) || 0;
  if (used >= PER_VISITOR_DAILY_LIMIT) {
    return res.status(429).json({ error: `You have used all ${PER_VISITOR_DAILY_LIMIT} free drafts for today. Please come back tomorrow.` });
  }
  if (totalCount >= ALL_VISITORS_DAILY_LIMIT) {
    return res.status(429).json({ error: "This demo has reached its daily limit. Please come back tomorrow." });
  }

  // 3. Ask the AI
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
          contents: [{ role: "user", parts: [{ text: `Product idea: ${idea}` }] }],
          generationConfig: {
            maxOutputTokens: 800,
            temperature: 0.6,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );

    if (!response.ok) {
      console.error("AI service error:", response.status, await response.text());
      return res.status(502).json({ error: "Something went wrong, please try again." });
    }

    const data = await response.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const prd = parts.map((p) => p.text || "").join("").trim();

    if (!prd) {
      return res.status(502).json({ error: "The AI sent back an empty answer, please try again." });
    }

    // 4. Count this use and send the draft back
    visitorCounts.set(visitor, used + 1);
    totalCount += 1;
    return res.status(200).json({ prd, remaining: PER_VISITOR_DAILY_LIMIT - (used + 1) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong, please try again." });
  }
};
