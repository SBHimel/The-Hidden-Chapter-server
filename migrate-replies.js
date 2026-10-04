require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('Error: MONGODB_URI is not defined in .env');
  process.exit(1);
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to MongoDB.');

    const db = client.db('hidden-chapter-db');
    const replyCollection = db.collection('replies');

    // Path to replies.json in frontend
    const repliesJsonPath = path.resolve(
      __dirname,
      '../The Hidden Chapter/src/data/replies.json'
    );

    if (!fs.existsSync(repliesJsonPath)) {
      console.error(`replies.json not found at ${repliesJsonPath}`);
      return;
    }

    const rawData = fs.readFileSync(repliesJsonPath, 'utf-8');
    const replies = JSON.parse(rawData);

    console.log(`Found ${replies.length} replies in replies.json`);

    let insertedCount = 0;
    let skippedCount = 0;

    for (const reply of replies) {
      // Check if reply already exists by id or createdAt + message
      const existing = await replyCollection.findOne({
        $or: [
          { id: reply.id },
          ...(ObjectId.isValid(reply.id) ? [{ _id: new ObjectId(reply.id) }] : []),
          { createdAt: reply.createdAt, message: reply.message },
        ],
      });

      if (existing) {
        console.log(`Skipping already existing reply (ID: ${reply.id})`);
        skippedCount++;
      } else {
        const docToInsert = {
          id: reply.id,
          name: reply.name || 'A Silent Reader',
          message: reply.message,
          createdAt: reply.createdAt,
          ...(reply.updatedAt ? { updatedAt: reply.updatedAt } : {}),
        };
        await replyCollection.insertOne(docToInsert);
        console.log(`Inserted reply (ID: ${reply.id}, Name: ${reply.name})`);
        insertedCount++;
      }
    }

    console.log(
      `Migration completed. Inserted: ${insertedCount}, Skipped: ${skippedCount}`
    );
  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    await client.close();
    console.log('MongoDB connection closed.');
  }
}

migrate();
