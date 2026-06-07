import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import Replicate from "replicate";

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "50mb" }));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_KEY });

app.get("/", (req, res) => {
  res.json({ status: "Fashion Try-On Backend is running 🚀", apiKeySet: !!process.env.REPLICATE_API_KEY });
});

app.post("/tryon", async (req, res) => {
  try {
    if (!process.env.REPLICATE_API_KEY) {
      return res.status(500).json({ success: false, error: "REPLICATE_API_KEY is not set" });
    }

    const { personImg, clothImg, garment } = req.body;
    if (!personImg || !clothImg) {
      return res.status(400).json({ success: false, error: "personImg and clothImg are required" });
    }

    console.log("Starting generation with Replicate SDK...");

    // ✅ Use Replicate SDK — handles FileOutput objects automatically
    const output = await replicate.run(
      "cuuupid/idm-vton:0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985",
      {
        input: {
          human_img:       personImg,
          garm_img:        clothImg,
          garment_des:     garment?.label    || "clothing item",
          category:        garment?.category || "upper_body",
          is_checked:      true,
          is_checked_crop: false,
          denoise_steps:   30,
          seed:            42,
        }
      }
    );

    console.log("Raw output type:", typeof output);
    console.log("Raw output:", JSON.stringify(output));

    // ✅ Extract URL from any format
    let imageUrl = null;

    if (Array.isArray(output)) {
      // SDK returns array of FileOutput objects — call toString() or use URL
      for (const item of output) {
        const str = String(item);
        if (str.startsWith("http")) { imageUrl = str; break; }
        if (item?.url) { imageUrl = String(item.url); break; }
      }
    } else if (output) {
      const str = String(output);
      if (str.startsWith("http")) imageUrl = str;
    }

    console.log("Final image URL:", imageUrl);

    if (!imageUrl || !imageUrl.startsWith("http")) {
      return res.status(500).json({ success: false, error: "Could not extract image URL from AI output" });
    }

    return res.json({ success: true, image: imageUrl });

  } catch (err) {
    console.error("Error:", err.message);

    // ✅ Friendly error for bad photo
    if (err.message?.includes("list index out of range")) {
      return res.status(400).json({
        success: false,
        error: "Could not detect body in photo. Please use a clear full-body photo of a person standing straight."
      });
    }

    return res.status(500).json({ success: false, error: err.message || "Server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`✅ API key: ${process.env.REPLICATE_API_KEY ? "SET ✓" : "NOT SET ✗"}`);
});