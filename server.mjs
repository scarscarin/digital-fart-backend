import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const upload = multer({ dest: 'uploads/' }); // Set the destination for uploads
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;

// Get __dirname equivalent in ES modules
const __dirname = new URL('.', import.meta.url).pathname;

// Serve static files from the public folder
app.use(express.static('public'));

// Route to handle file uploads
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    // Construct the file path correctly
    const filePath = path.join(process.cwd(), req.file.path); // Use process.cwd() for the current working directory
    const fileContent = fs.readFileSync(filePath);
    const dropboxPath = `/audio/${req.file.originalname}`;

    const dropboxResponse = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: dropboxPath,
          mode: 'add',
          autorename: true,
          mute: false
        }),
      },
      body: fileContent,
    });

    const dropboxData = await dropboxResponse.json();
    console.log('Dropbox response:', dropboxData);

    // Remove the uploaded file from local storage
    fs.unlinkSync(filePath);

    if (dropboxResponse.ok) {
      res.json({ message: 'File uploaded successfully!', dropboxData });
    } else {
      res.status(500).json({ message: 'Failed to upload to Dropbox', error: dropboxData });
    }
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

// Route to fetch the audio archive from Dropbox
app.get('/archive', async (req, res) => {
  try {
    const dropboxResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: '/audio' }),
    });

    const data = await dropboxResponse.json();

    if (dropboxResponse.ok) {
      const audioFiles = data.entries.map(entry => ({
        name: entry.name,
        link: `https://www.dropbox.com/home/audio/${entry.name}?raw=1`,
      }));
      res.json({ entries: audioFiles });
    } else {
      res.status(500).json({ message: 'Failed to retrieve archive', error: data });
    }
  } catch (error) {
    console.error('Error fetching archive:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
