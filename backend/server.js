import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";

const app = express();

// ── CORS — allow your Vercel frontend ────────────────────────────────────────
app.use(cors({
  origin: "*", // You can restrict to your Vercel URL later e.g. "https://fashion-tryon-frontend.vercel.app"
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));

app.use(express.json({ limit: "20mb" })); // 20mb to handle base64 images

const API_KEY = process.env.REPLICATE_API_KEY;

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "Fashion Try-On Backend is running 🚀",
    apiKeySet: !!API_KEY,
  });
});

// ── Try-On Route ──────────────────────────────────────────────────────────────
app.post("/tryon", async (req, res) => {
  try {
    // 1. Check API key
    if (!API_KEY) {
      return res.status(500).json({
        success: false,
        error: "REPLICATE_API_KEY is not set in environment variables",
      });
    }

    // 2. Validate request body
    const { personImg, clothImg, garment } = req.body;

    if (!personImg || !clothImg) {
      return res.status(400).json({
        success: false,
        error: "personImg and clothImg are required",
      });
    }

    // 3. Create prediction on Replicate
    // ✅ CORRECT IDM-VTON model version hash
    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4",
        input: {
          human_img:       personImg,
          garm_img:        clothImg,
          garment_des:     garment?.label    || "clothing item",
          category:        garment?.category || "upper_body",
          is_checked:      true,
          is_checked_crop: false,
          denoise_steps:   30,
          seed:            42,
        },
      }),
    });

    const prediction = await createRes.json();

    if (!createRes.ok) {
      console.error("Replicate create error:", prediction);
      return res.status(400).json({
        success: false,
        error: prediction.detail || prediction.error || "Failed to start AI generation",
      });
    }

    console.log(`Prediction created: ${prediction.id}`);

    // 4. Poll for result (max 3 minutes = 60 attempts x 3s)
    let output = null;

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const pollRes = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        { headers: { Authorization: `Token ${API_KEY}` } }
      );

      const data = await pollRes.json();
      console.log(`Poll ${i + 1}: status = ${data.status}`);

      if (data.status === "succeeded") {
        output = data.output?.[0] ?? data.output;
        break;
      }

      if (data.status === "failed") {
        return res.status(500).json({
          success: false,
          error: data.error || "AI model failed to generate image",
        });
      }
    }

    // 5. Handle timeout
    if (!output) {
      return res.status(408).json({
        success: false,
        error: "Timed out waiting for AI. Please try again.",
      });
    }

    // 6. Return result
    console.log("Generation succeeded:", output);
    return res.json({ success: true, image: output });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Unexpected server error",
    });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`✅ Replicate API key: ${API_KEY ? "SET ✓" : "NOT SET ✗"}`);
});