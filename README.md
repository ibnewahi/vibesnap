# 🎵 VibeSnap

> Capture the vibe of any moment with AI-powered imagery.

VibeSnap is a full-stack web application that uses Groq AI to generate visual search queries from abstract mood descriptions, then fetches matching landscape images from Unsplash.

## ✨ Features

- 🤖 **AI-Powered Query Generation** - Groq Mixtral 8x7B translates abstract vibes into specific visual search terms
- 🖼️ **High-Quality Images** - Fetches landscape images from Unsplash
- 🔒 **Lock Images** - Lock your favorite images to keep them during regeneration
- 🔄 **Regenerate Individual Images** - Refresh any unlocked image with a new AI-generated query
- 🎨 **Beautiful Glass-Morphism UI** - Dark theme with stunning visual effects
- 📱 **Fully Responsive** - Works on desktop, tablet, and mobile
- ⚡ **Fast & Efficient** - Parallel API calls with 30-second timeout protection
- 🛡️ **Comprehensive Error Handling** - Graceful degradation with demo mode fallback

## 📁 Project Structure

```
vibesnap-backend/
├── server.js                 # Express server with API endpoints
├── package.json              # Dependencies and scripts
├── .env.example              # Environment variables template
├── .gitignore                # Git ignore rules
├── README.md                 # This file
├── services/
│   ├── groqService.js        # Groq AI service for query generation
│   └── unsplashService.js    # Unsplash service for image fetching
└── public/
    └── frontend.html         # Complete frontend (HTML/CSS/JS)
```

## 🚀 Quick Start

### Prerequisites

- Node.js >= 16.x
- npm >= 8.x
- Groq API Key (free at https://console.groq.com/)
- Unsplash Access Key (free at https://unsplash.com/developers)

### Installation

1. **Clone or download the project:**
   ```bash
   cd vibesnap-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` and add your API keys:**
   ```bash
   # Get your Groq API key at: https://console.groq.com/
   GROQ_API_KEY=your_groq_api_key_here

   # Get your Unsplash Access Key at: https://unsplash.com/developers
   UNSPLASH_ACCESS_KEY=your_unsplash_access_key_here
   ```

5. **Start the server:**
   ```bash
   # Development mode (with auto-reload)
   npm run dev

   # Production mode
   npm start
   ```

6. **Open your browser:**
   ```
   http://localhost:5000
   ```

## 📡 API Endpoints

### Health Check
```
GET /ping
```
Returns: `OK`

### Service Status
```
GET /api/v1/status
```
Returns:
```json
{
  "status": "running",
  "service": "VibeSnap",
  "version": "1.0.0",
  "environment": "development",
  "apis": {
    "groq": "✅ configured",
    "unsplash": "✅ configured"
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Generate Vibe Images
```
POST /api/generate
Content-Type: application/json

{
  "prompt": "melancholy autumn evening with golden leaves"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "queries": [
      "golden maple leaves at dusk",
      "autumn park bench sunset",
      "misty forest orange leaves",
      "silhouette fall foliage",
      "amber leaves backlit"
    ],
    "images": [
      "https://images.unsplash.com/photo-...",
      "https://images.unsplash.com/photo-...",
      "https://images.unsplash.com/photo-...",
      "https://images.unsplash.com/photo-...",
      "https://images.unsplash.com/photo-..."
    ]
  },
  "meta": {
    "prompt": "melancholy autumn evening with golden leaves",
    "queryCount": 5,
    "imageCount": 5,
    "durationMs": 2340,
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

### Regenerate Single Image
```
POST /api/regenerate
Content-Type: application/json

{
  "prompt": "melancholy autumn evening with golden leaves",
  "index": 2
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "imageUrl": "https://images.unsplash.com/photo-...",
    "query": "misty forest path covered in orange leaves",
    "index": 2
  },
  "meta": {
    "prompt": "melancholy autumn evening with golden leaves",
    "durationMs": 1850,
    "timestamp": "2024-01-15T10:31:00.000Z"
  }
}
```

## 🎨 Frontend Features

### Interactive UI
- **Vibe Input** - Type your mood or click quick-select chips
- **Loading Animation** - Beautiful pulsating spinner with 3-step progress
- **Gallery Grid** - Responsive 5-image layout with glass-morphism cards
- **Lock/Unlock** - Click 🔓 to lock images (prevents regeneration)
- **Refresh** - Click 🔄 to get a new image (disabled when locked)
- **Error Handling** - User-friendly error messages with retry button
- **Demo Mode** - Automatic demo mode when server is unavailable

### Quick Select Chips
- 🍂 Autumn Melancholy
- 🌃 Cyberpunk Energy
- 🏔️ Mountain Serenity
- 💫 90s Nostalgia
- 🌅 Tropical Sunset

## 🛠️ Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 5000) |
| `NODE_ENV` | No | Environment (default: development) |
| `GROQ_API_KEY` | Yes | Groq API key for AI query generation |
| `UNSPLASH_ACCESS_KEY` | Yes | Unsplash access key for image fetching |

### CORS Configuration

By default, CORS allows all origins. To restrict in production, edit `server.js`:

```javascript
const corsOptions = {
  origin: 'https://yourdomain.com', // Restrict to your domain
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
```

## 🐛 Troubleshooting

### "Cannot connect to server"
- Make sure the server is running: `npm run dev`
- Check that port 5000 is not in use
- Verify the frontend is accessing `http://localhost:5000`

### "GROQ_API_KEY is not configured"
- Copy `.env.example` to `.env`: `cp .env.example .env`
- Add your Groq API key to `.env`
- Restart the server

### "UNSPLASH_ACCESS_KEY is not configured"
- Copy `.env.example` to `.env`: `cp .env.example .env`
- Add your Unsplash Access Key to `.env`
- Restart the server

### "Rate limit exceeded"
- Groq has rate limits on free tier
- Wait a few moments and try again
- Consider upgrading your Groq plan

### "Request timed out"
- Groq API took longer than 30 seconds
- Try again - it might be temporary high load
- Check your internet connection

## 📊 Tech Stack

### Backend
- **Express.js** - Web framework
- **Axios** - HTTP client for API calls
- **CORS** - Cross-origin resource sharing
- **dotenv** - Environment variable management

### Frontend
- **Pure HTML/CSS/JavaScript** - No frameworks, no dependencies
- **CSS Grid** - Responsive layout
- **CSS Custom Properties** - Theming
- **Glass-morphism Design** - Modern UI effects

### APIs
- **Groq API** - AI-powered query generation (Mixtral 8x7B model)
- **Unsplash API** - High-quality landscape images

## 📝 License

MIT License - feel free to use this project for learning or commercial purposes.

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest new features
- Submit pull requests
- Improve documentation

## 🙏 Acknowledgments

- **Groq** - For providing fast AI inference
- **Unsplash** - For beautiful, free-to-use images
- **Express.js** - For the robust web framework

## 📞 Support

If you encounter any issues:
1. Check the Troubleshooting section above
2. Review the error messages in the console
3. Verify your API keys are correctly configured
4. Make sure all dependencies are installed

---

**Built with ❤️ by the VibeSnap Team**
