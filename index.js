require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://the-hidden-chapter.vercel.app',
  ...(process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(',').map((url) => url.trim().replace(/\/+$/, ''))
    : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      const normalizedOrigin = origin.replace(/\/+$/, '');
      if (
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes(normalizedOrigin) ||
        allowedOrigins.includes('*')
      ) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Helper to format MongoDB document for client response
function formatReply(doc) {
  if (!doc) return null;
  return {
    id: doc.id || doc._id.toString(),
    name: doc.name || 'A Silent Reader',
    message: doc.message,
    createdAt: doc.createdAt,
    ...(doc.updatedAt ? { updatedAt: doc.updatedAt } : {}),
  };
}


// Helper to match reply by id (either custom string id or MongoDB ObjectId)
function buildIdQuery(id) {
  const conditions = [{ id: id }];
  if (ObjectId.isValid(id)) {
    try {
      conditions.push({ _id: new ObjectId(id) });
    } catch {
      // ignore
    }
  }
  return { $or: conditions };
}

async function run() {
  try {
    // MongoDB connect
    // await client.connect();

    const db = client.db('hidden-chapter-db');
    const userCollection = db.collection('users');
    const replyCollection = db.collection('replies');

    // Home route
    app.get('/', (req, res) => {
      res.send('Server is running and MongoDB is connected!');
    });

    // Users route
    app.get('/users', async (req, res) => {
      try {
        const result = await userCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch users.' });
      }
    });

    // ---------------------------------------------
    // Reply / Comment CRUD API Endpoints
    // ---------------------------------------------

    // 1. GET /api/replies - Fetch all replies (sorted newest first)
    app.get('/api/replies', async (req, res) => {
      try {
        const replies = await replyCollection.find().sort({ createdAt: -1 }).toArray();
        res.json({
          success: true,
          replies: replies.map(formatReply),
        });
      } catch (error) {
        console.error('Error fetching replies:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch replies from database.',
          replies: [],
        });
      }
    });

    // 2. POST /api/replies - Create a new reply
    app.post('/api/replies', async (req, res) => {
      try {
        const { name, message } = req.body || {};

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Message content is required.',
          });
        }

        const _id = new ObjectId();
        const newReply = {
          _id,
          id: _id.toString(),
          name: name && typeof name === 'string' && name.trim() ? name.trim() : 'A Silent Reader',
          message: message.trim(),
          createdAt: new Date().toISOString(),
        };

        await replyCollection.insertOne(newReply);

        const allReplies = await replyCollection.find().sort({ createdAt: -1 }).toArray();

        res.status(201).json({
          success: true,
          reply: formatReply(newReply),
          replies: allReplies.map(formatReply),
        });
      } catch (error) {
        console.error('Error saving reply:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to save reply to database.',
        });
      }
    });

    // 3. PUT /api/replies/:id (and /api/replies with id in body) - Update a reply
    const handleUpdateReply = async (req, res) => {
      try {
        const id = req.params.id || req.body?.id;
        const { name, message } = req.body || {};

        if (!id) {
          return res.status(400).json({
            success: false,
            message: 'Reply ID is required.',
          });
        }

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Message content cannot be empty.',
          });
        }

        const filter = buildIdQuery(id);
        const existing = await replyCollection.findOne(filter);

        if (!existing) {
          return res.status(404).json({
            success: false,
            message: 'Reply not found.',
          });
        }

        const updateDoc = {
          $set: {
            ...(name !== undefined
              ? { name: typeof name === 'string' && name.trim() ? name.trim() : 'A Silent Reader' }
              : {}),
            message: message.trim(),
            updatedAt: new Date().toISOString(),
          },
        };

        await replyCollection.updateOne(filter, updateDoc);

        const updated = await replyCollection.findOne(filter);
        const allReplies = await replyCollection.find().sort({ createdAt: -1 }).toArray();

        res.json({
          success: true,
          reply: formatReply(updated),
          replies: allReplies.map(formatReply),
        });
      } catch (error) {
        console.error('Error updating reply:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to update reply.',
        });
      }
    };

    app.put('/api/replies/:id', handleUpdateReply);
    app.put('/api/replies', handleUpdateReply);

    // 4. DELETE /api/replies/:id (and /api/replies with id in query/body) - Delete a reply
    const handleDeleteReply = async (req, res) => {
      try {
        const id = req.params.id || req.query.id || req.body?.id;

        if (!id) {
          return res.status(400).json({
            success: false,
            message: 'Reply ID is required.',
          });
        }

        const filter = buildIdQuery(id);
        const result = await replyCollection.deleteOne(filter);

        if (result.deletedCount === 0) {
          return res.status(404).json({
            success: false,
            message: 'Reply not found.',
          });
        }

        const allReplies = await replyCollection.find().sort({ createdAt: -1 }).toArray();

        res.json({
          success: true,
          message: 'Reply deleted successfully.',
          replies: allReplies.map(formatReply),
        });
      } catch (error) {
        console.error('Error deleting reply:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to delete reply.',
        });
      }
    };

    app.delete('/api/replies/:id', handleDeleteReply);
    app.delete('/api/replies', handleDeleteReply);

    // MongoDB connection check
    // await client.db('admin').command({ ping: 1 });
    console.log('Successfully connected to MongoDB!');

    // Start server
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error('MongoDB connection error:', error);
  }
}

run();