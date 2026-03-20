// Vercel API route handler
// This file wraps the Express backend for Vercel serverless deployment

import server from '../backend/server.js';

// For Vercel serverless functions, we need to convert Express to handler
// Using @vercel/express pattern for compatibility
export default async function handler(req, res) {
  // Set headers for CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Forward the request to Express
  return new Promise((resolve, reject) => {
    server(req, res, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
