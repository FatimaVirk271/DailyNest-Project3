// routes/stats.js - GET /api/stats
// The progress numbers are calculated by the DATABASE (COUNT / SUM / GROUP BY in store.stats()).
const express = require('express');
const store = require('../store');
const { asyncHandler } = require('../middleware');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await store.stats() });
}));

module.exports = router;
