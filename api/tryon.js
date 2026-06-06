app.post("/tryon", async (req, res) => {
  try {
    const apiKey = process.env.REPLICATE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "REPLICATE_API_KEY is not set"
      });
    }

    const { personImg, clothImg, garment } = req.body;

    if (!personImg || !clothImg) {
      return res.status(400).json({
        success: false,
        error: "personImg and clothImg are required"
      });
    }

    // 1️⃣ Create prediction
    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "906425dbca90663ff5427624839572cc56ea7d380343d13e2a4c4b09d3f0c30f",
        input: {
          human_img: personImg,
          garm_img: clothImg,
          garment_des: garment?.label || "clothing",
          category: garment?.category || "upper_body",
          is_checked: true,
          is_checked_crop: false,
          denoise_steps: 30,
          seed: 42
        }
      })
    });

    const prediction = await createRes.json();

    if (!createRes.ok) {
      return res.status(400).json({
        success: false,
        error: prediction.detail || "Failed to create prediction"
      });
    }

    // 2️⃣ Poll result
    let output = null;

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const pollRes = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            Authorization: `Token ${apiKey}`
          }
        }
      );

      const data = await pollRes.json();

      if (data.status === "succeeded") {
        output = data.output?.[0] ?? data.output;
        break;
      }

      if (data.status === "failed") {
        return res.status(500).json({
          success: false,
          error: data.error || "Prediction failed"
        });
      }
    }

    if (!output) {
      return res.status(408).json({
        success: false,
        error: "Timeout: model took too long"
      });
    }

    // 3️⃣ Success response
    return res.json({
      success: true,
      image: output
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});