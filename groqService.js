const axios = require('axios');

// ──────────────────────────────────────────────
// Groq API Configuration
// ──────────────────────────────────────────────
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';

const SYSTEM_PROMPT = `You are an expert at translating abstract feelings into specific visual search terms. You must output strictly valid JSON with a key called "queries" that contains an array of exactly 5 string search terms. Do not include any other text, only the JSON.`;

/**
 * Generates 5 visual search queries from an abstract user prompt
 * using the Groq API (Mixtral 8x7B model).
 *
 * @param {string} userPrompt - The user's abstract feeling/vibe description
 * @returns {Promise<string[]>} Array of 5 search query strings
 * @throws {Error} If the API request fails or JSON parsing fails
 */
async function generateSearchQueries(userPrompt) {
  // ── Validate API key ──────────────────────
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set in environment variables');
  }

  if (!userPrompt || typeof userPrompt !== 'string') {
    throw new Error('userPrompt must be a non-empty string');
  }

  try {
    // ── Call Groq API ───────────────────────
    const response = await axios.post(
      GROQ_API_URL,
      {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 512,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    // ── Extract response content ────────────
    const content = response.data?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content returned from Groq API');
    }

    // ── Parse JSON safely ───────────────────
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      // Fallback: try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1].trim());
        } catch {
          throw new Error(
            `Failed to parse Groq response as JSON: ${parseError.message}`
          );
        }
      } else {
        throw new Error(
          `Failed to parse Groq response as JSON: ${parseError.message}`
        );
      }
    }

    // ── Validate structure ──────────────────
    if (!parsed.queries || !Array.isArray(parsed.queries)) {
      throw new Error('Response does not contain a valid "queries" array');
    }

    // Return exactly 5 queries (slice in case model returns more)
    return parsed.queries.slice(0, 5);
  } catch (error) {
    // ── Handle API errors ───────────────────
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.error?.message || JSON.stringify(error.response.data);
      throw new Error(`Groq API error (HTTP ${status}): ${detail}`);
    }

    if (error.code === 'ECONNABORTED') {
      throw new Error('Groq API request timed out (30s)');
    }

    // Re-throw our own errors or wrap unknown ones
    throw error;
  }
}

module.exports = { generateSearchQueries };
