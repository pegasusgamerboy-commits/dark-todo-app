import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.AWS_REGION) {
  console.error('Missing AWS_REGION');
  process.exit(1);
}
if (!process.env.TABLE_NAME) {
  console.error('Missing TABLE_NAME');
  process.exit(1);
}

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const db = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;
const PK = 'TODOS';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.type('text').send('ok');
});

app.get('/api/todos', async (req, res) => {
  try {
    const result = await db.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': PK }
    }));
    const todos = (result.Items || []).map(item => ({
      id: item.sk.replace('TODO#', ''),
      text: item.text,
      completed: item.completed,
      createdAt: item.createdAt
    }));
    res.json(todos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/todos', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const item = {
      pk: PK,
      sk: 'TODO#' + id,
      text: text.trim(),
      completed: false,
      createdAt
    };
    await db.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    res.status(201).json({ id, text: item.text, completed: false, createdAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { completed, text } = req.body;
    const updates = [];
    const values = { ':sk': 'TODO#' + id };
    if (typeof completed === 'boolean') {
      updates.push('completed = :completed');
      values[':completed'] = completed;
    }
    if (typeof text === 'string' && text.trim()) {
      updates.push('text = :text');
      values[':text'] = text.trim();
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid updates' });
    }
    await db.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK, sk: 'TODO#' + id },
      UpdateExpression: 'SET ' + updates.join(', '),
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW'
    }));
    const result = await db.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK, sk: 'TODO#' + id }
    }));
    if (!result.Item) {
      return res.status(404).json({ error: 'Not found' });
    }
    const item = result.Item;
    res.json({ id, text: item.text, completed: item.completed, createdAt: item.createdAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK, sk: 'TODO#' + id }
    }));
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/todos', async (req, res) => {
  try {
    const result = await db.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      FilterExpression: 'completed = :completed',
      ExpressionAttributeValues: { ':pk': PK, ':completed': true }
    }));
    for (const item of result.Items || []) {
      await db.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { pk: PK, sk: item.sk }
      }));
    }
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Server running on port 3000');
});
