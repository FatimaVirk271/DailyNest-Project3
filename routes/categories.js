// routes/categories.js - GET /api/categories
// Reads the second table. Shows the one-to-many link: each category and how many tasks it owns.
const express = require('express');
const store = require('../store');

const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({ success: true, data: store.categories() });
});

module.exports = router;
