const axios = require('axios');

// ──────────────────────────────────────────────
// Unsplash API Configuration
// ──────────────────────────────────────────────
const UNSPLASH_API_URL = 'https://api.unsplash.com/search/photos';

/**
 * Fetches one landscape image per search query from Unsplash.
 *
 * @param {string[]} queriesArray - Array of search terms (typically 5)
 * @returns {Promise<string[]>} Array of image URLs (regular size)
 * @throws {Error} If the API key is missing or input is invalid
 */
async function fetchImagesByQueries(queriesArray) {
  // ── Validate API key ──────────────────────
  if (!process.env.UNSPLASH_ACCESS_KEY) {
    throw new Error('UNSPLASH_ACCESS_KEY is not set in environment variables');
  }

  if (!Array.isArray(queriesArray) || queriesArray.length === 0) {
    throw new Error('queriesArray must be a non-empty array of search terms');
  }

  // ── Fetch images in parallel ──────────────
  const results = await Promise.allSettled(
    queriesArray.map(async (query) => {
      const response = await axios.get(UNSPLASH_API_URL, {
        params: {
          query,
          per_page: 1,
          orientation: 'landscape',
        },
        headers: {
          Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
        },
        timeout: 15000,
      });

      const photo = response.data?.results?.[0];

      if (!photo) {
        throw new Error(`No images found for query: "${query}"`);
      }

      return photo.urls.regular;
    })
  );

  // ── Collect successful results ────────────
  const imageUrls = [];
  const errors = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      imageUrls.push(result.value);
    } else {
      errors.push({ query: queriesArray[index], error: result.reason.message });
      console.warn(
        `⚠️  Failed to fetch image for "${queriesArray[index]}": ${result.reason.message}`
      );
    }
  });

  if (imageUrls.length === 0) {
    throw new Error(
      `Failed to fetch any images. Errors: ${errors.map((e) => e.error).join('; ')}`
    );
  }

  if (errors.length > 0) {
    console.log(
      `ℹ️  Retrieved ${imageUrls.length}/${queriesArray.length} images (${errors.length} failed)`
    );
  }

  return imageUrls;
}

module.exports = { fetchImagesByQueries };
