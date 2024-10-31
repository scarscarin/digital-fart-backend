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

const allowedOrigins = ['https://leoscarin.com'];

// Add CORS middleware
app.use(cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`Origin ${origin} not allowed by CORS`);
        callback(new Error('Not allowed by CORS'));
      }
    },
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

    // Function to ensure the '/audio' folder exists
    async function ensureAudioFolderExists() {
      const createFolderResponse = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: '/audio', autorename: false }),
      });

      if (createFolderResponse.ok) {
        console.log('Audio folder created.');
      } else {
        const errorData = await createFolderResponse.json();
        if (errorData.error && errorData.error['.tag'] === 'path' && errorData.error.path['.tag'] === 'conflict') {
          console.log('Audio folder already exists.');
        } else {
          console.error('Error creating audio folder:', errorData);
          throw new Error('Failed to ensure audio folder exists.');
        }
      }
    }

    // Ensure the '/audio' folder exists
    await ensureAudioFolderExists();

    // Set the filename to "Fart.wav" without the emoji
    const fileName = 'Fart.wav';
    const dropboxPath = `/audio/${fileName}`;

    // Prepare the arguments for the Dropbox API
    const args = {
      path: dropboxPath,
      mode: 'add',
      autorename: true, // Let Dropbox handle duplicates
      mute: false,
    };

    const jsonArgs = JSON.stringify(args);

    // Upload file to Dropbox
    const dropboxResponse = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': jsonArgs,
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

    res.status(500).json({ message: 'Server error', error: error.message });
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
        // Get a temporary link for each file
        const tempLinkResponse = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            path: entry.path_lower,
          }),
        });

        const tempLinkData = await tempLinkResponse.json();

        if (tempLinkResponse.ok) {
          const link = tempLinkData.link;
          // Prepend the emoji to the display name
          const displayName = `💨 ${entry.name.replace('.wav', '')}`;
          return {
            name: displayName,
            link,
          };
        } else {
          console.error('Error getting temporary link:', tempLinkData);
          return null; // Skip this entry if there's an error
        }
      }))).filter(file => file !== null); // Filter out null entries

      res.json({ entries: audioFiles });
    } else {
      console.error('Error retrieving archive:', data);
      res.status(500).json({ message: 'Failed to retrieve archive', error: data });
    }
  } catch (error) {
    console.error('Error fetching archive:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});



// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
