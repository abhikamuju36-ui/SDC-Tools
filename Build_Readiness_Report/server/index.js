require('dotenv').config();
const express = require('express');
const path = require('path');

const bomRoutes = require('./routes/bom');
const readinessRoutes = require('./routes/readiness');
const emailRoutes = require('./routes/emails');
const checkRoutes = require('./routes/check');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(express.json());

// API routes
app.use('/api/check', checkRoutes);
app.use('/api/bom', bomRoutes);
app.use('/api/readiness', readinessRoutes);
app.use('/api/emails', emailRoutes);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SDC Build Readiness Report running at http://localhost:${PORT}`);
});
