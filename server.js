const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const { generateSearchQueries } = require('./groqService');
const { fetchImagesByQueries } = require('./unsplashService');
const rateLimit = require('express-rate-limit');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ──────────────────────────────────────────────
// Environment Variables
// ──────────────────────────────────────────────
const {
  GROQ_API_KEY,
  UNSPLASH_ACCESS_KEY,
  NODE_ENV = 'development'
} = process.env;

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

// ──────────────────────────────────────────────
// CORS Configuration
// ──────────────────────────────────────────────
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
// Rate Limiting: Max 5 requests per 15 minutes per IP address
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
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
// ── Download Endpoints ──────────────────────
// 1. Single Image Download (Instant)
app.get('/download-single', async (req, res) => {
  const { url } = req.query;
  try {
    const response = await axios({
      url: url,
      method: 'GET',
      responseType: 'stream'
    });
    res.setHeader('Content-Disposition', 'attachment; filename="vibesnap-image.jpg"');
    response.data.pipe(res);
  } catch (error) {
    res.status(500).send('Failed to download image');
  }
});

// 2. Download All (Opens all images in new tabs)
app.get('/download-all', async (req, res) => {
  const urls = JSON.parse(req.query.urls || '[]');
  if (urls.length === 0) return res.status(400).send('No images provided');
  
  // Generate an HTML page that auto-opens all the images
  let html = `<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
    <h2>Your images are opening in new tabs!</h2>
    <p>If your browser blocked them, please allow pop-ups and try again.</p>
    <script>
      const urls = ${JSON.stringify(urls)};
      urls.forEach(url => { window.open(url, '_blank'); });
    <\/script>
  </body></html>`;
  
  res.send(html);
});
app.use('/images', (req, res) => { res.redirect(req.url); });

// ──────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// Health Check Route
// ──────────────────────────────────────────────
app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});

// ──────────────────────────────────────────────
// Serve Frontend
// ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'frontend.html'));
});

// ──────────────────────────────────────────────
// API Routes
// ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// POST /api/generate
// ──────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { prompt } = req.body;

  // Validate input
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'Request body must include a non-empty "prompt" string.'
    });
  }

  // Check API keys
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
    // Step 1: Generate search queries via Groq
    console.log(`🤖 [Step 1/2] Generating search queries via Groq...`);

    const GROQ_TIMEOUT_MS = 30000;
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

    // Step 2: Fetch images via Unsplash
    console.log(`🖼️  [Step 2/2] Fetching images from Unsplash...`);
    const images = await fetchImagesByQueries(queries);

    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('Unsplash service returned no images');
    }

    const totalDuration = Date.now() - startTime;
    console.log(`✅ [Step 2/2] Fetched ${images.length} images in ${totalDuration - groqDuration}ms`);
    console.log(`🎉 [Generate] Complete — total time: ${totalDuration}ms\n`);

    // FIXED: Removed the extra `{` here
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

// ──────────────────────────────────────────────
// POST /api/regenerate
// ──────────────────────────────────────────────
app.post('/api/regenerate', async (req, res) => {
  const { prompt, index } = req.body;

  // Validate input
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

  // Check API keys
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
    // Step 1: Generate search queries via Groq
    console.log(`🤖 [Step 1/2] Generating new queries via Groq...`);

    const GROQ_TIMEOUT_MS = 30000;
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

    // Validate index is within bounds
    if (index >= queries.length) {
      throw new Error(`Index ${index} is out of bounds. Got ${queries.length} queries.`);
    }

    const groqDuration = Date.now() - startTime;
    console.log(`✅ [Step 1/2] Generated ${queries.length} queries in ${groqDuration}ms`);
    console.log(`   Using query at index ${index}: "${queries[index]}"`);

    // Step 2: Fetch single image from Unsplash
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

    // FIXED: Removed the extra `{` here
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

// ──────────────────────────────────────────────
// 404 Handler
// ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: 'The requested route does not exist.'
  });
});

// ──────────────────────────────────────────────
// Global Error Handler
// ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// Handle uncaught exceptions
// ──────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('\n💥 [Uncaught Exception]');
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  console.error('');

  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// ──────────────────────────────────────────────
// Handle unhandled promise rejections
// ──────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 [Unhandled Rejection]');
  console.error('Reason:', reason);
  console.error('');
});

// ──────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────
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

module.exports = app;