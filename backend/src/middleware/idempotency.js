const db = require('../config/db');

const idempotency = async (req, res, next) => {
  const key = req.headers['idempotency-key'];
  
  if (!key) {
    return next();
  }

  const merchantId = req.merchant.id;

  try {
    // Check for existing key
    const query = 'SELECT * FROM idempotency_keys WHERE key = $1 AND merchant_id = $2';
    const result = await db.query(query, [key, merchantId]);
    const existing = result.rows[0];

    if (existing) {
      if (new Date() > new Date(existing.expires_at)) {
        // Expired: Delete and treat as new
        await db.query('DELETE FROM idempotency_keys WHERE key = $1 AND merchant_id = $2', [key, merchantId]);
      } else {
        // Return cached response
        return res.status(201).json(existing.response);
      }
    }

    const originalJson = res.json;
    res.json = function (body) {
      const saveResponse = async () => {
         try {
             // Expires in 24 hours
             const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
             const insertQuery = `
               INSERT INTO idempotency_keys (key, merchant_id, response, expires_at)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (key, merchant_id) DO NOTHING
             `;
             await db.query(insertQuery, [key, merchantId, body, expiresAt]);
         } catch (err) {
             console.error('Failed to save idempotency key:', err);
         }
      };
      
      saveResponse();
      
      return originalJson.call(this, body);
    };

    next();

  } catch (error) {
    console.error('Idempotency Error:', error);
    next(); // Proceed on error? Or fail? Fail safe is usually proceed or error.
  }
};

module.exports = idempotency;
