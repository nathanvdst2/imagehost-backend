// ===== IMPORTATION DES MODULES =====
const express = require('express');        // Framework web pour Node.js
const multer = require('multer');          // Gestion des uploads de fichiers
const sharp = require('sharp');            // Traitement et optimisation d'images
const cors = require('cors');              // Permet les requêtes cross-origin
const cloudinary = require('cloudinary').v2; // Service de stockage d'images
require('dotenv').config();                // Charge les variables d'environnement

const app = express(); // Création de l'application Express

// ===== CONFIGURATION CLOUDINARY =====
// Configure l'accès à votre compte Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,    // Nom de votre cloud (ex: "dxxxxxxxxx")
  api_key: process.env.CLOUDINARY_API_KEY,          // Clé API (ex: "123456789012345")
  api_secret: process.env.CLOUDINARY_API_SECRET     // Secret API (ex: "abcdefg...")
});

// ===== MIDDLEWARE (Logiciels intermédiaires) =====
// CORS : Permet à votre frontend (GitHub Pages) de communiquer avec ce backend
app.use(cors({
  origin: true,        // Accepte toutes les origines (pour la simplicité)
  credentials: true    // Permet l'envoi de cookies/auth
}));

// Parse les données JSON avec une limite de 50MB
app.use(express.json({ limit: '50mb' }));

// ===== CONFIGURATION MULTER =====
// Multer gère l'upload de fichiers depuis le frontend
const upload = multer({
  // Stockage en mémoire (temporaire)
  storage: multer.memoryStorage(),
  
  // Limites de sécurité
  limits: { 
    fileSize: 10 * 1024 * 1024, // 10MB maximum par fichier
    files: 5                     // Maximum 5 fichiers à la fois
  },
  
  // Filtrage des types de fichiers
  fileFilter: (req, file, cb) => {
    console.log('Fichier reçu:', file.originalname, file.mimetype);
    
    // Types d'images autorisés
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);  // Fichier accepté
    } else {
      cb(new Error(`Type de fichier non autorisé: ${file.mimetype}`), false);
    }
  }
});

// ===== ROUTE DE TEST =====
// Route simple pour vérifier que le serveur fonctionne
app.get('/', (req, res) => {
  res.json({ 
    message: 'Backend ImageHost actif ✅', 
    timestamp: new Date().toISOString(),
    cloudinary: !!process.env.CLOUDINARY_CLOUD_NAME // Vérifie si Cloudinary est configuré
  });
});

// ===== ROUTE PRINCIPALE D'UPLOAD =====
// Cette route reçoit les images du frontend et les traite
app.post('/api/upload', upload.array('images', 5), async (req, res) => {
  console.log('=== DÉBUT UPLOAD ===');
  console.log('Nombre de fichiers reçus:', req.files?.length || 0);
  
  try {
    // Vérification : au moins un fichier reçu
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Aucun fichier reçu'
      });
    }

    const results = []; // Tableau pour stocker les résultats
    
    // Traiter chaque fichier un par un
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      console.log(`Traitement fichier ${i + 1}:`, file.originalname);
      
      try {
        // ===== OPTIMISATION DE L'IMAGE AVEC SHARP =====
        const optimizedBuffer = await sharp(file.buffer)
          .resize(1920, 1080, { 
            fit: 'inside',           // Garde les proportions
            withoutEnlargement: true // N'agrandit pas les petites images
          })
          .jpeg({ 
            quality: 85,       // Qualité JPEG (85% = bon compromis taille/qualité)
            progressive: true  // Chargement progressif
          })
          .toBuffer(); // Résultat en mémoire
        
        console.log(`Fichier optimisé: ${file.buffer.length} -> ${optimizedBuffer.length} bytes`);
        
        // ===== UPLOAD VERS CLOUDINARY =====
        const uploadResult = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              resource_type: 'image',
              // Génère un ID unique : img_timestamp_randomstring
              public_id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              quality: 'auto',        // Optimisation automatique
              fetch_format: 'auto',   // Format optimal selon le navigateur
              flags: 'progressive'    // Chargement progressif
            },
            (error, result) => {
              if (error) {
                console.error('Erreur Cloudinary:', error);
                reject(error);
              } else {
                console.log('Upload Cloudinary réussi:', result.public_id);
                resolve(result);
              }
            }
          );
          
          // Envoie les données à Cloudinary
          uploadStream.end(optimizedBuffer);
        });
        
        // Ajouter les informations de l'image aux résultats
        results.push({
          url: uploadResult.secure_url,      // URL HTTPS de l'image
          publicId: uploadResult.public_id,  // ID Cloudinary (pour suppression)
          size: uploadResult.bytes,          // Taille finale en bytes
          width: uploadResult.width,         // Largeur en pixels
          height: uploadResult.height,       // Hauteur en pixels
          format: uploadResult.format,       // Format final (jpg, png, etc.)
          originalName: file.originalname    // Nom original du fichier
        });
        
      } catch (fileError) {
        // Si une image échoue, on continue avec les autres
        console.error(`Erreur fichier ${file.originalname}:`, fileError);
        results.push({
          error: `Erreur traitement ${file.originalname}: ${fileError.message}`,
          originalName: file.originalname
        });
      }
    }
    
    console.log('=== RÉSULTATS ===');
    console.log(`${results.length} fichiers traités`);
    
    // Séparer les succès des erreurs
    const successResults = results.filter(r => !r.error);
    const errorResults = results.filter(r => r.error);
    
    // Renvoyer la réponse au frontend
    res.json({
      success: true,
      images: successResults,  // Images uploadées avec succès
      errors: errorResults,    // Erreurs éventuelles
      total: results.length
    });
    
  } catch (error) {
    console.error('=== ERREUR GÉNÉRALE ===');
    console.error(error);
    
    res.status(500).json({
      success: false,
      error: 'Erreur serveur: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ===== ROUTE DE SUPPRESSION =====
// Permet de supprimer une image via son ID Cloudinary
app.delete('/api/delete/:publicId', async (req, res) => {
  try {
    const result = await cloudinary.uploader.destroy(req.params.publicId);
    console.log('Suppression:', result);
    
    res.json({ 
      success: true, 
      message: 'Image supprimée',
      result: result 
    });
  } catch (error) {
    console.error('Erreur suppression:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ===== ROUTE DE DIAGNOSTIC =====
// Utile pour vérifier que tout fonctionne
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK ✅', 
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,                      // Version de Node.js
      platform: process.platform,                // Système d'exploitation
      memory: process.memoryUsage(),              // Utilisation mémoire
      cloudinary: {
        configured: !!process.env.CLOUDINARY_CLOUD_NAME,
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'non configuré'
      }
    }
  });
});

// ===== GESTION DES ERREURS =====
// Intercepte les erreurs Multer et autres
app.use((error, req, res, next) => {
  console.error('=== ERREUR MIDDLEWARE ===');
  console.error(error);
  
  // Erreurs spécifiques à Multer
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'Fichier trop volumineux (max 10MB)'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Trop de fichiers (max 5)'
      });
    }
  }
  
  // Erreur générique
  res.status(500).json({
    success: false,
    error: 'Erreur serveur: ' + error.message
  });
});

// ===== GESTION DES ROUTES NON TROUVÉES =====
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route non trouvée: ${req.method} ${req.originalUrl}`
  });
});

// ===== DÉMARRAGE DU SERVEUR =====
const PORT = process.env.PORT || 3000; // Port fourni par la plateforme ou 3000
app.listen(PORT, () => {
  console.log('🚀 Serveur démarré sur le port', PORT);
  console.log('📊 Cloudinary configuré:', !!process.env.CLOUDINARY_CLOUD_NAME);
  console.log('🔗 URL de test:', `http://localhost:${PORT}/api/health`);
});
