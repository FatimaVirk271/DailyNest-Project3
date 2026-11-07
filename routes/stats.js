// routes/stats.js - GET /api/stats
// The progress numbers are now calculated by the DATABASE (COUNT / SUM / GROUP BY in store.stats()).
const express = require('express');
const store = require('../store');

const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({ success: true, data: store.stats() });
});

module.exports = router;
