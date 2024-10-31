// server.mjs

// Import dependencies
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// Load environment variables from .env file
dotenv.config();

// Set FFmpeg path for fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Initialize the Express app
const app = express();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    // Accept only audio files
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  },
});

// Dropbox access token from environment variables
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;

// Allowed origins for CORS
const allowedOrigins = ['https://leoscarin.com']; // Replace with your frontend domain

// Set up CORS middleware
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or CURL requests)
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
  })
);

// Serve static files in the 'public' directory (index.html, etc.)
app.use(express.static('public'));

// Route to handle file uploads
app.post('/upload', upload.single('audio'), async (req, res) => {
  console.log('Received file:', req.file);
  try {
    // Path of the uploaded file
    const uploadedFilePath = path.join(process.cwd(), req.file.path);
    const originalExtension = path.extname(req.file.originalname).toLowerCase();
    const fileNameWithoutExt = path.parse(req.file.filename).name;
    const mp3FileName = `${fileNameWithoutExt}.mp3`;
    const mp3FilePath = path.join(process.cwd(), 'uploads', mp3FileName);

    // Convert the uploaded file to MP3 if necessary
    if (originalExtension !== '.mp3') {
      // Convert to MP3 using FFmpeg
      await new Promise((resolve, reject) => {
        ffmpeg(uploadedFilePath)
          .toFormat('mp3')
          .on('error', (err) => {
            console.error('An error occurred during conversion:', err.message);
            reject(err);
          })
          .on('end', () => {
            console.log('Conversion to MP3 completed.');
            resolve();
          })
          .save(mp3FilePath);
      });

      // Read the MP3 file content
      var fileContent = fs.readFileSync(mp3FilePath);

      // Remove the original uploaded file
      fs.unlink(uploadedFilePath, (err) => {
        if (err) {
          console.error('Error deleting original uploaded file:', err);
        }
      });
    } else {
      // If the uploaded file is already an MP3, read it directly
      var fileContent = fs.readFileSync(uploadedFilePath);
    }

    // Function to ensure the '/audio' folder exists on Dropbox
    async function ensureAudioFolderExists() {
      const createFolderResponse = await fetch(
        'https://api.dropboxapi.com/2/files/create_folder_v2',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${DROPBOX_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path: '/audio', autorename: false }),
        }
      );

      if (createFolderResponse.ok) {
        console.log('Audio folder created.');
      } else {
        const errorData = await createFolderResponse.json();
        if (
          errorData.error &&
          errorData.error['.tag'] === 'path' &&
          errorData.error.path['.tag'] === 'conflict'
        ) {
          console.log('Audio folder already exists.');
        } else {
          console.error('Error creating audio folder:', errorData);
          throw new Error('Failed to ensure audio folder exists.');
        }
      }
    }

    // Ensure the '/audio' folder exists
    await ensureAudioFolderExists();

    // Set the filename to "Fart.mp3" (without the emoji)
    const fileName = 'Fart.mp3';
    const dropboxPath = `/audio/${fileName}`;

    // Prepare the arguments for the Dropbox API
    const args = {
      path: dropboxPath,
      mode: 'add',
      autorename: true, // Let Dropbox handle duplicates
      mute: false,
    };

    const jsonArgs = JSON.stringify(args);

    // Upload MP3 file to Dropbox
    const dropboxResponse = await fetch(
      'https://content.dropboxapi.com/2/files/upload',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${DROPBOX_ACCESS_TOKEN}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': jsonArgs,
        },
        body: fileContent,
      }
    );

    // Handle Dropbox upload errors
    if (!dropboxResponse.ok) {
      let errorData;
      try {
        errorData = await dropboxResponse.json();
      } catch (e) {
        errorData = await dropboxResponse.text();
      }
      console.error('Dropbox upload error:', errorData);

      // Delete the local MP3 file
      fs.unlink(mp3FilePath, (err) => {
        if (err) {
          console.error('Error deleting local MP3 file:', err);
        }
      });

      return res
        .status(500)
        .json({ message: 'Failed to upload to Dropbox', error: errorData });
    }

    // Proceed if the upload was successful
    const dropboxData = await dropboxResponse.json();

    // Remove the local MP3 file if it exists
    if (fs.existsSync(mp3FilePath)) {
      fs.unlink(mp3FilePath, (err) => {
        if (err) {
          console.error('Error deleting local MP3 file:', err);
        }
      });
    } else if (fs.existsSync(uploadedFilePath)) {
      // Remove the uploaded file if it's an MP3 and we haven't deleted it yet
      fs.unlink(uploadedFilePath, (err) => {
        if (err) {
          console.error('Error deleting uploaded file:', err);
        }
      });
    }

    // Send success response
    res.json({ message: 'File uploaded successfully!', dropboxData });
  } catch (error) {
    console.error('Error uploading file:', error);

    // Ensure the local files are deleted in case of an error
    if (req.file && req.file.path) {
      const uploadedFilePath = path.join(process.cwd(), req.file.path);
      if (fs.existsSync(uploadedFilePath)) {
        fs.unlink(uploadedFilePath, (err) => {
          if (err) {
            console.error('Error deleting uploaded file:', err);
          }
        });
      }
    }

    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Route to fetch the archive of uploaded audio files from Dropbox
app.get('/archive', async (req, res) => {
  try {
    const dropboxResponse = await fetch(
      'https://api.dropboxapi.com/2/files/list_folder',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${DROPBOX_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: '/audio' }),
      }
    );

    const data = await dropboxResponse.json();

    if (dropboxResponse.ok) {
      const audioFiles = (
        await Promise.all(
          data.entries.map(async (entry) => {
            // Get a temporary link for each file
            const tempLinkResponse = await fetch(
              'https://api.dropboxapi.com/2/files/get_temporary_link',
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${DROPBOX_ACCESS_TOKEN}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  path: entry.path_lower,
                }),
              }
            );

            const tempLinkData = await tempLinkResponse.json();

            if (tempLinkResponse.ok) {
              const link = tempLinkData.link;
              // Prepend the emoji to the display name
              const displayName = `💨 ${entry.name
                .replace('.mp3', '')
                .replace('.wav', '')}`;
              return {
                name: displayName,
                link,
              };
            } else {
              console.error('Error getting temporary link:', tempLinkData);
              return null; // Skip this entry if there's an error
            }
          })
        )
      ).filter((file) => file !== null); // Filter out null entries

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
