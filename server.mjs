import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const upload = multer({ dest: 'uploads/' });
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;

// Add CORS middleware
app.use(cors({
  origin: 'https://leoscarin.com', // Update if your frontend is hosted elsewhere
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Serve static files in the 'public' directory (index.html, etc.)
app.use(express.static('public'));

// Route to handle file uploads
app.post('/upload', upload.single('audio'), async (req, res) => {
  console.log('Received file:', req.file);
  try {
    // Path of the uploaded file
    const filePath = path.join(process.cwd(), req.file.path);
    const fileContent = fs.readFileSync(filePath);
    const dropboxPath = `/audio/${req.file.originalname}`;

    // Upload file to Dropbox
    const dropboxResponse = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: dropboxPath,
          mode: 'add',
          autorename: true,
          mute: false,
        }),
      },
      body: fileContent,
    });

    // Handle Dropbox upload errors
    if (!dropboxResponse.ok) {
      const errorData = await dropboxResponse.json();
      console.error('Dropbox upload error:', errorData);

      // Delete the local file
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error('Error deleting local file:', err);
        }
      });

      return res.status(500).json({ message: 'Failed to upload to Dropbox', error: errorData });
    }

    // Proceed if the upload was successful
    const dropboxData = await dropboxResponse.json();

    // Remove the file from local storage
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Error deleting local file:', err);
      }
    });

    // Send success response
    res.json({ message: 'File uploaded successfully!', dropboxData });
  } catch (error) {
    console.error('Error uploading file:', error);

    // Ensure the local file is deleted in case of an error
    if (req.file && req.file.path) {
      const filePath = path.join(process.cwd(), req.file.path);
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error('Error deleting local file:', err);
        }
      });
    }

    res.status(500).json({ message: 'Server error', error });
  }
});

// Route to fetch the archive of uploaded audio files from Dropbox
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
      const audioFiles = (await Promise.all(data.entries.map(async (entry) => {
        // Create a shared link for each file
        const sharedLinkResponse = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            path: entry.path_lower,
            settings: {
              requested_visibility: 'public',
              audience: 'public',
              access: 'viewer',
            },
          }),
        });

        const sharedLinkData = await sharedLinkResponse.json();

        // Extract the direct download URL
        let link = '';
        if (sharedLinkResponse.ok) {
          link = sharedLinkData.url.replace('?dl=0', '?raw=1');
        } else if (sharedLinkData.error && sharedLinkData.error.shared_link_already_exists) {
          // If a shared link already exists, retrieve it
          link = sharedLinkData.error.shared_link_already_exists.metadata.url.replace('?dl=0', '?raw=1');
        } else {
          console.error('Error creating shared link:', sharedLinkData);
          return null; // Skip this entry if there's an error
        }

        return {
          name: entry.name,
          link,
        };
      }))).filter(file => file !== null); // Filter out null entries

      res.json({ entries: audioFiles });
    } else {
      console.error('Error retrieving archive:', data);
      res.status(500).json({ message: 'Failed to retrieve archive', error: data });
    }
  } catch (error) {
    console.error('Error fetching archive:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

// Root route (optional) to serve a simple message or redirect to index.html
app.get('/', (req, res) => {
  res.send('Welcome to the Digital Fart Backend API');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
