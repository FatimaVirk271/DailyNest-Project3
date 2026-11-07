// routes/admin.js - protected endpoint (needs the x-api-key header).
// Shows authentication (401 = no key) and authorization (403 = wrong key).
const express = require('express');
const store = require('../store');
const { requireApiKey, asyncHandler } = require('../middleware');

const router = express.Router();

// POST /api/admin/reset -> put the four starter tasks back
router.post('/reset', requireApiKey, asyncHandler(async (req, res) => {
  const tasks = await store.reset();
  res.status(200).json({ success: true, data: { tasks } });
}));

module.exports = router;
