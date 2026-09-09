const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const { generateSearchQueries } = require('./groqService');
const { fetchImagesByQueries } = require('./unsplashService');
const rateLimit = require('express-rate-limit');
const ffmpeg = require('fluent-ffmpeg');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Environment Variables
const { GROQ_API_KEY, UNSPLASH_ACCESS_KEY, NODE_ENV = 'development' } = process.env;

// Validate required environment variables
const requiredEnvVars = { GROQ_API_KEY, UNSPLASH_ACCESS_KEY };
const missingVars = Object.entries(requiredEnvVars)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.warn(
    `⚠️  Warning: Missing environment variables: ${missingVars.join(', ')}\n` +
    `   Copy .env.example to .env and fill in your API keys.\n`
  );
}

// CORS Configuration
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));

// ──────────────────────────────────────────────
// Video & Audio Merge Route (FIXED)
// ──────────────────────────────────────────────
app.post('/api/merge-video', (req, res) => {
  const { videoBase64 } = req.body;
  const musicPath = path.join(__dirname, 'public', 'music.mp3');
  
  // Convert base64 video to a temporary file
  const tempVideoPath = path.join(__dirname, 'temp_video.webm');
  require('fs').writeFileSync(tempVideoPath, Buffer.from(videoBase64, 'base64'));

  const outputPath = path.join(__dirname, 'final_video.mp4');

  ffmpeg(tempVideoPath)
    .input(musicPath)
    .outputOptions(['-c:v copy', '-c:a aac', '-shortest'])
    .on('end', () => {
      res.download(outputPath, 'vibesnap-reel.mp4', () => {
        // Clean up temp files
        require('fs').unlinkSync(tempVideoPath);
        require('fs').unlinkSync(outputPath);
      });
    })
    .on('error', (err) => {
      console.error('FFmpeg Error:', err.message);
      res.status(500).send('Failed to merge audio');
    })
    .save(outputPath);
});

// Proxy for images (Allows video generation to work without CORS errors)
app.get('/api/proxy-image', async (req, res) => {
  const { url } = req.query;
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    res.set('Content-Type', 'image/jpeg');
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).send('Error fetching image');
  }
});

// Rate Limiting: Increased to 1000 for testing
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Change to 5 when going live
  message: {
    success: false,
    error: 'Rate limit exceeded',
    message: 'Too many requests. Please wait 15 minutes and try again.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply the rate limiter to all your generate/regenerate API routes
app.use('/api/generate', limiter);
app.use('/api/regenerate', limiter);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`
    );
  });
  next();
});

// Health Check Route
app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});

// Serve Frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'frontend.html'));
});

// API Routes
app.get('/api/v1/status', (req, res) => {
  res.json({
    status: 'running',
    service: 'VibeSnap',
    version: '1.0.0',
    environment: NODE_ENV,
    apis: {
      groq: GROQ_API_KEY ? '✅ configured' : '❌ missing',
      unsplash: UNSPLASH_ACCESS_KEY ? '✅ configured' : '❌ missing'
    },
    timestamp: new Date().toISOString()
  });
});

// POST /api/generate
app.post('/api/generate', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'Request body must include a non-empty "prompt" string.'
    });
  }

  if (!GROQ_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'Service Unavailable',
      message: 'GROQ_API_KEY is not configured on the server.'
    });
  }

  if (!UNSPLASH_ACCESS_KEY) {
    return res.status(503).json({
      success: false,
      error: 'Service Unavailable',
      message: 'UNSPLASH_ACCESS_KEY is not configured on the server.'
    });
  }

  const startTime = Date.now();
  console.log(`\n🎨 [Generate] New request — prompt: "${prompt}"`);

  try {
    console.log(`🤖 [Step 1/2] Generating search queries via Groq...`);

    const GROQ_TIMEOUT_MS = 60000;
    const queries = await Promise.race([
      generateSearchQueries(prompt.trim()),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Groq API call timed out after 30 seconds')),
          GROQ_TIMEOUT_MS
        )
      )
    ]);

    if (!Array.isArray(queries) || queries.length === 0) {
      throw new Error('Groq service returned no valid queries');
    }

    const groqDuration = Date.now() - startTime;
    console.log(`✅ [Step 1/2] Generated ${queries.length} queries in ${groqDuration}ms`);

    console.log(`🖼️  [Step 2/2] Fetching images from Unsplash...`);
    const images = await fetchImagesByQueries(queries);

    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('Unsplash service returned no images');
    }

    const totalDuration = Date.now() - startTime;
    console.log(`✅ [Step 2/2] Fetched ${images.length} images in ${totalDuration - groqDuration}ms`);
    console.log(`🎉 [Generate] Complete — total time: ${totalDuration}ms\n`);

    return res.status(200).json({
      success: true,
      data: {
        queries,
        images
      },
      meta: {
        prompt: prompt.trim(),
        queryCount: queries.length,
        imageCount: images.length,
        durationMs: totalDuration,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`❌ [Generate] Failed after ${totalDuration}ms:`, error.message);

    if (error.message.includes('GROQ_API_KEY')) {
      return res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Groq API key is not configured.'
      });
    }

    if (error.message.includes('UNSPLASH_ACCESS_KEY')) {
      return res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Unsplash API key is not configured.'
      });
    }

    if (error.message.includes('timed out')) {
      return res.status(504).json({
        success: false,
        error: 'Gateway Timeout',
        message: 'The AI query generation took too long. Please try again.'
      });
    }

    if (error.message.includes('Groq API error')) {
      return res.status(502).json({
        success: false,
        error: 'Bad Gateway',
        message: `Groq API error: ${error.message}`
      });
    }

    if (error.message.includes('Unsplash') || error.message.includes('No images found')) {
      return res.status(502).json({
        success: false,
        error: 'Bad Gateway',
        message: `Unsplash API error: ${error.message}`
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred while generating your vibe. Please try again.'
    });
  }
});

// POST /api/regenerate
app.post('/api/regenerate', async (req, res) => {
  const { prompt, index } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'Request body must include a non-empty "prompt" string.'
    });
  }

  if (index === undefined || typeof index !== 'number' || index < 0 || !Number.isInteger(index)) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'Request body must include a valid "index" (non-negative integer).'
    });
  }

  if (!GROQ_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'Service Unavailable',
      message: 'GROQ_API_KEY is not configured on the server.'
    });
  }

  if (!UNSPLASH_ACCESS_KEY) {
    return res.status(503).json({
      success: false,
      error: 'Service Unavailable',
      message: 'UNSPLASH_ACCESS_KEY is not configured on the server.'
    });
  }

  const startTime = Date.now();
  console.log(`\n🔄 [Regenerate] Request — prompt: "${prompt}", index: ${index}`);

  try {
    console.log(`🤖 [Step 1/2] Generating new queries via Groq...`);

    const GROQ_TIMEOUT_MS = 60000;
    const queries = await Promise.race([
      generateSearchQueries(prompt.trim()),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Groq API call timed out after 30 seconds')),
          GROQ_TIMEOUT_MS
        )
      )
    ]);

    if (!Array.isArray(queries) || queries.length === 0) {
      throw new Error('Groq service returned no valid queries');
    }

    if (index >= queries.length) {
      throw new Error(`Index ${index} is out of bounds. Got ${queries.length} queries.`);
    }

    const groqDuration = Date.now() - startTime;
    console.log(`✅ [Step 1/2] Generated ${queries.length} queries in ${groqDuration}ms`);
    console.log(`   Using query at index ${index}: "${queries[index]}"`);

    console.log(`🖼️  [Step 2/2] Fetching single image from Unsplash...`);
    const singleQuery = [queries[index]];
    const images = await fetchImagesByQueries(singleQuery);

    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('Unsplash service returned no images');
    }

    const newImageUrl = images[0];
    const totalDuration = Date.now() - startTime;
    console.log(`✅ [Step 2/2] Fetched new image in ${totalDuration - groqDuration}ms`);
    console.log(`🎉 [Regenerate] Complete — total time: ${totalDuration}ms\n`);

    return res.status(200).json({
      success: true,
      data: {
        imageUrl: newImageUrl,
        query: queries[index],
        index: index
      },
      meta: {
        prompt: prompt.trim(),
        durationMs: totalDuration,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`❌ [Regenerate] Failed after ${totalDuration}ms:`, error.message);

    if (error.message.includes('GROQ_API_KEY')) {
      return res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Groq API key is not configured.'
      });
    }

    if (error.message.includes('UNSPLASH_ACCESS_KEY')) {
      return res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Unsplash API key is not configured.'
      });
    }

    if (error.message.includes('timed out')) {
      return res.status(504).json({
        success: false,
        error: 'Gateway Timeout',
        message: 'The AI query generation took too long. Please try again.'
      });
    }

    if (error.message.includes('Groq API error')) {
      return res.status(502).json({
        success: false,
        error: 'Bad Gateway',
        message: `Groq API error: ${error.message}`
      });
    }

    if (error.message.includes('Unsplash') || error.message.includes('No images found')) {
      return res.status(502).json({
        success: false,
        error: 'Bad Gateway',
        message: `Unsplash API error: ${error.message}`
      });
    }

    if (error.message.includes('out of bounds')) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: error.message
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred while regenerating the image. Please try again.'
    });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: 'The requested route does not exist.'
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('\n❌ [Global Error Handler]');
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  console.error('Path:', req.path);
  console.error('Method:', req.method);
  console.error('Body:', req.body);
  console.error('');

  let statusCode = err.status || err.statusCode || 500;
  let errorType = 'Internal Server Error';
  let errorMessage = 'An unexpected error occurred. Please try again later.';

  if (err.name === 'SyntaxError' && 'body' in err) {
    statusCode = 400;
    errorType = 'Bad Request';
    errorMessage = 'Invalid JSON in request body.';
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    errorType = 'Bad Request';
    errorMessage = 'Invalid JSON format in request body.';
  } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    statusCode = 503;
    errorType = 'Service Unavailable';
    errorMessage = 'Unable to connect to external service.';
  } else if (err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
    statusCode = 504;
    errorType = 'Gateway Timeout';
    errorMessage = 'Request to external service timed out.';
  } else if (err.message.includes('rate limit') || err.response?.status === 429) {
    statusCode = 429;
    errorType = 'Too Many Requests';
    errorMessage = 'Rate limit exceeded. Please try again later.';
  } else if (err.response?.status === 401 || err.response?.status === 403) {
    statusCode = 503;
    errorType = 'Service Unavailable';
    errorMessage = 'Authentication with external service failed.';
  } else if (statusCode === 404) {
    errorType = 'Not Found';
    errorMessage = 'The requested resource was not found.';
  } else if (statusCode === 400) {
    errorType = 'Bad Request';
    errorMessage = err.message || 'Invalid request parameters.';
  }

  const response = {
    success: false,
    error: errorType,
    message: errorMessage,
    timestamp: new Date().toISOString()
  };

  if (process.env.NODE_ENV === 'development') {
    response.details = {
      originalError: err.message,
      stack: err.stack
    };
  }

  res.status(statusCode).json(response);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('\n💥 [Uncaught Exception]');
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  console.error('');

  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 [Unhandled Rejection]');
  console.error('Reason:', reason);
  console.error('');
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n🚀 VibeSnap server running on port ${PORT}`);
  console.log(`📡 Environment: ${NODE_ENV}`);
  console.log(`🤖 Groq API: ${GROQ_API_KEY ? 'configured' : 'NOT configured'}`);
  console.log(`🖼️  Unsplash API: ${UNSPLASH_ACCESS_KEY ? 'configured' : 'NOT configured'}`);
  console.log(`\n📌 Endpoints:`);
  console.log(`   GET  /                  → Frontend`);
  console.log(`   GET  /ping              → Health check`);
  console.log(`   GET  /api/v1/status     → Service status`);
  console.log(`   POST /api/generate      → Generate vibe images`);
  console.log(`   POST /api/regenerate    → Regenerate single image\n`);
});

