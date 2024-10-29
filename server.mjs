import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import cors from 'cors';  // Import CORS middleware

dotenv.config();

const app = express();
const upload = multer({ dest: 'uploads/' });
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;

// Enable CORS globally
app.use(cors({
    origin: 'https://leoscarin.com',  // Allow only requests from your website
    methods: ['GET', 'POST'],          // Specify allowed HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allow necessary headers
}));

// Serve static files in the 'public' directory (index.html, etc.)
app.use(express.static('public'));

// Route to handle file uploads
app.post('/upload', upload.single('audio'), async (req, res) => {
    try {
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
                    mute: false
                }),
            },
            body: fileContent,
        });

        const dropboxData = await dropboxResponse.json();

        // Remove the file from local storage
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
