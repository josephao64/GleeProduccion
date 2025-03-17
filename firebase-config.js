// firebase-config.js

// Importa las funciones base de Firebase (versión 9+)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

// Configuración de tu proyecto Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBoBj8-oqIwAOJG7aplYPWt7q4J3wigbmc",
  authDomain: "gleedb-d9478.firebaseapp.com",
  projectId: "gleedb-d9478",
  storageBucket: "gleedb-d9478.firebasestorage.app",
  messagingSenderId: "722495997438",
  appId: "1:722495997438:web:19fd9152263a4651feacaf"
};

// Inicializa la app de Firebase con tu configuración
const app = initializeApp(firebaseConfig);

// Obtén una instancia de Firestore
const db = getFirestore(app);

// Exporta la instancia para poder usarla en otros archivos
export { db };
