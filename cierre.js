import { db } from "./firebase-config.js";
import {
  collection,
  query,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

// Al cargar el DOM, se consulta y renderiza el historial de cierres
document.addEventListener("DOMContentLoaded", async () => {
  await loadCierres();
});

// Función para cargar y renderizar los cierres
async function loadCierres() {
  try {
    const cierresRef = collection(db, "cierres");
    // Se ordena de forma descendente por fecha de cierre para mostrar el cierre más reciente primero
    const q = query(cierresRef, orderBy("fechaCierre", "desc"));
    const snapshot = await getDocs(q);
    const tbody = document.querySelector("#cierresTable tbody");
    tbody.innerHTML = "";
    
    snapshot.forEach(docSnap => {
      const cierre = docSnap.data();
      // Construcción de la fila usando los mismos campos que se usan al cerrar caja en ventas
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${cierre.idAperturaNum || "-"}</td>
        <td>${cierre.usuario || "-"}</td>
        <td>${cierre.fechaApertura} ${cierre.horaApertura}</td>
        <td>${cierre.fechaCierre} ${cierre.horaCierre}</td>
        <td>Q ${Number(cierre.montoApertura || 0).toFixed(2)}</td>
        <td>Q ${Number(cierre.totalEfectivo || 0).toFixed(2)}</td>
        <td>Q ${Number(cierre.totalGeneral || 0).toFixed(2)}</td>
        <td>Q ${Number(cierre.totalEfectivoSistema || 0).toFixed(2)}</td>
        <td>Q ${Number(cierre.totalIngresado || 0).toFixed(2)}</td>
        <td>Q ${Number(cierre.diferencia || 0).toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error("Error al cargar cierres:", error);
    Swal.fire("Error", "No se pudieron cargar los cierres: " + error.message, "error");
  }
}
