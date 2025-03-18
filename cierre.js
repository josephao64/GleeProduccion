/*******************************************************
 * cierre.js - Reporte de Cierres de Caja
 *******************************************************/
import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  updateDoc,
  deleteDoc,
  doc
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

const loggedUserRole = (localStorage.getItem("loggedUserRole") || "").toLowerCase();
let tablaCierres;

$(document).ready(function () {
  tablaCierres = $("#tablaCierres").DataTable({
    language: { url: "https://cdn.datatables.net/plug-ins/1.13.4/i18n/es-ES.json" },
    order: [[0, "desc"]],
    responsive: true
  });
  cargarCierres();
  $("#filtroFecha").on("change", cargarCierres);
});

// Función para formatear fecha a dd/mm/yyyy
function formatDate(date) {
  if (isNaN(date.getTime())) return "Fecha no disponible";
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

// Función para parsear fecha: si el string contiene "/" se asume dd/mm/yyyy
function parseDate(str) {
  if (!str) return new Date();
  if (str.indexOf("/") > -1) {
    const parts = str.split("/");
    // Asumimos formato dd/mm/yyyy
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }
  return new Date(str);
}

// Función para convertir la fecha del input (yyyy-mm-dd) al formato dd/mm/yyyy
function convertInputDate(inputDate) {
  if (!inputDate) return "";
  const parts = inputDate.split("-");
  if (parts.length !== 3) return inputDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

async function cargarCierres() {
  const filtroFecha = document.getElementById("filtroFecha").value;
  // Convertir la fecha del input al formato dd/mm/yyyy
  const fechaFiltro = filtroFecha ? convertInputDate(filtroFecha) : "";
  
  let cierresQuery = fechaFiltro
    ? query(collection(db, "cierres"), where("fechaCierre", "==", fechaFiltro))
    : query(collection(db, "cierres"), orderBy("fechaCierre", "desc"));

  const snapshot = await getDocs(cierresQuery);
  tablaCierres.clear();

  snapshot.forEach((docSnap) => {
    const cierre = docSnap.data();
    cierre.id = docSnap.id;
    // Se asume que cierre.fechaCierre se guarda en formato dd/mm/yyyy y se muestra correctamente
    const fechaFormateada = cierre.fechaCierre ? formatDate(parseDate(cierre.fechaCierre)) : "Fecha no disponible";
    const fechaHora = `${fechaFormateada} ${cierre.horaCierre || ""}`;

    const montoApertura = Number(cierre.montoApertura || 0);
    const totalEfectivo = Number(cierre.totalEfectivo || 0);
    const totalIngresado = Number(cierre.totalIngresado || 0);
    const totalEfectivoSistema = montoApertura + totalEfectivo;
    const diferenciaCalculada = totalEfectivoSistema - totalIngresado;
    // Se asume que en el documento de cierre se guarda el campo numérico idReporteCierre
    let acciones = `<button class="btn btn-sm btn-info" onclick="verDetalleCierre('${cierre.idReporteCierre}')">VER</button>`;
    acciones += ` <button class="btn btn-sm btn-secondary" onclick="descargarReportePDF('${cierre.idReporteCierre}')">Descargar PDF</button>`;
    if (loggedUserRole === "admin") {
      acciones += ` <button class="btn btn-sm btn-warning" onclick="anularCierre('${docSnap.id}')">ANULAR</button>`;
      acciones += ` <button class="btn btn-sm btn-danger" onclick="eliminarCierre('${docSnap.id}')">ELIMINAR</button>`;
    }
    tablaCierres.row.add([
      fechaHora,
      cierre.usuario,
      "Q " + Number(cierre.totalGeneral || 0).toFixed(2),
      "Q " + montoApertura.toFixed(2),
      "Q " + totalEfectivoSistema.toFixed(2),
      "Q " + totalIngresado.toFixed(2),
      "Q " + diferenciaCalculada.toFixed(2),
      acciones
    ]);
  });
  tablaCierres.draw();
}

window.verDetalleCierre = async function (idReporteCierre) {
  console.log("Buscando reporte para idReporteCierre:", idReporteCierre);
  const idReporteNum = Number(idReporteCierre);
  const reporteQuery = query(
    collection(db, "reporteCierre"),
    where("idReporteCierre", "==", idReporteNum)
  );
  const reporteSnap = await getDocs(reporteQuery);
  if (reporteSnap.empty) {
    console.error("Reporte no encontrado para el idReporteCierre:", idReporteCierre);
    return Swal.fire("Error", "Reporte no encontrado.", "error");
  }
  let reporteHtml;
  reporteSnap.forEach((docSnap) => {
    const data = docSnap.data();
    reporteHtml = data.report;
  });

  Swal.fire({
    title: "Detalle del Cierre",
    html: reporteHtml,
    width: "90%"
  });
};

window.anularCierre = async (id) => {
  await updateDoc(doc(db, "cierres", id), { estado: "ANULADA" });
  cargarCierres();
};

window.eliminarCierre = async (id) => {
  await deleteDoc(doc(db, "cierres", id));
  cargarCierres();
};


function generarReporteCierreHTML(ventas, cierre) {
  // Calcular diferencia: Diferencia = Arqueo - Total efectivo (donde Total efectivo = montoApertura + totalEfectivo)
  const diff = Number(cierre.totalIngresado || 0) - Number(cierre.totalEfectivoSistema || 0);
  const colorDiferencia = diff >= 0 ? "green" : "red";
  // Formatear la fecha de cierre usando parseDate y formatDate
  const fechaFormateada = cierre.fechaCierre ? formatDate(parseDate(cierre.fechaCierre)) : "Fecha no disponible";

  // Resumen de ventas por método
  const efectivo = Number(cierre.totalEfectivo || 0);
  const tarjeta = Number(cierre.totalTarjeta || 0);
  const transferencia = Number(cierre.totalTransferencia || 0);
  const enLinea = Number(cierre.ventaLinea || 0);
  const totalResumen = efectivo + tarjeta + transferencia + enLinea;

  return `
    <div class="container" style="max-width: 900px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <!-- Encabezado en una sola línea -->
      <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
        <div style="text-align: left;">
          <div><strong>ID Cierre:</strong> <span style="font-size: 1.2em;">${cierre.idCierre}</span></div>
          <div><strong>Fecha de cierre:</strong> <span>${fechaFormateada}</span></div>
          <div><strong>Hora:</strong> <span>${cierre.horaCierre || "-"}</span></div>
          <div><strong>Lugar:</strong> <span>${cierre.usuario || "-"}</span></div>
        </div>
        <div style="text-align: right;">
          <div><strong>Monto de Apertura:</strong> <span style="font-size: 1.2em;">Q ${Number(cierre.montoApertura || 0).toFixed(2)}</span></div>
        </div>
      </div>
      
      <!-- Detalle de Ventas (Resumen) -->
      <h5 style="border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-bottom: 10px;">Detalle de Ventas</h5>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead style="background-color: #f5f5f5;">
          <tr>
            <th style="border: 1px solid #ddd; padding: 8px;">Efectivo</th>
            <th style="border: 1px solid #ddd; padding: 8px;">Tarjeta</th>
            <th style="border: 1px solid #ddd; padding: 8px;">Transferencia</th>
            <th style="border: 1px solid #ddd; padding: 8px;">En línea</th>
            <th style="border: 1px solid #ddd; padding: 8px;">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">Q ${efectivo.toFixed(2)}</td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">Q ${tarjeta.toFixed(2)}</td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">Q ${transferencia.toFixed(2)}</td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">Q ${enLinea.toFixed(2)}</td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">Q ${totalResumen.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      
      <!-- Totales -->
      <h5 style="border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-bottom: 10px;">Totales</h5>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead style="background-color: #f5f5f5;">
          <tr>
            <th style="border: 1px solid #ddd; padding: 8px;">Total efectivo</th>
            <th style="border: 1px solid #ddd; padding: 8px;">Arqueo</th>
            <th style="border: 1px solid #ddd; padding: 8px;">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">Q ${Number(cierre.totalEfectivoSistema || 0).toFixed(2)}</td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">Q ${Number(cierre.totalIngresado || 0).toFixed(2)}</td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">
              <span style="color: ${colorDiferencia};">
                ${diff >= 0 ? diff.toFixed(2) : "-" + Math.abs(diff).toFixed(2)}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      
      <!-- Ventas Detalladas -->
      <h5 style="border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-bottom: 10px;">Ventas Detalladas</h5>
      <table style="width: 100%; border-collapse: collapse;">
        <thead style="background-color: #f5f5f5;">
          <tr>
            <th style="border: 1px solid #ddd; padding: 8px;">Id venta</th>
            <th style="border: 1px solid #ddd; padding: 8px;">Método de pago</th>
            <th style="border: 1px solid #ddd; padding: 8px;">N° Referencia</th>
            <th style="border: 1px solid #ddd; padding: 8px;">Monto</th>
            <th style="border: 1px solid #ddd; padding: 8px;">Vendedor</th>
          </tr>
        </thead>
        <tbody>
          ${ventas.length > 0
            ? ventas.map((v, index) => `
            <tr>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${v.idVenta || index + 1}</td>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${v.metodo_pago || "-"}</td>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${
                v.metodo_pago && v.metodo_pago.trim().toLowerCase() === "transferencia"
                  ? (v.numeroTransferencia || "-")
                  : "-"
              }</td>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">Q ${Number(v.total || 0).toFixed(2)}</td>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${v.empleadoNombre || "-"}</td>
            </tr>
          `).join("")
            : `<tr><td colspan="5" style="text-align: center;">No se encontraron ventas</td></tr>`}
        </tbody>
      </table>
      
      <!-- Botón para Descargar PDF (NO se incluirá en el PDF final) -->
      <div style="margin-top: 20px; text-align: center;">
        <button class="btn btn-primary" onclick="descargarReportePDF('${cierre.idReporteCierre}')">Descargar PDF</button>
      </div>
    </div>
  `;
}

/*******************************************************
 * Cargar Productos (función incluida solo si se requiere)
 *******************************************************/
async function loadProductos() {
  try {
    const cProductos = collection(db, "productos");
    const qProds = query(cProductos, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(qProds);
    let productos = [];
    snapshot.forEach(docSnap => {
      let prod = docSnap.data();
      prod.id = docSnap.id;
      productos.push(prod);
    });
    // Si se requiere renderizar productos, asegúrate de tener definida la función renderProducts.
    if (typeof renderProducts === "function") {
      renderProducts(productos);
    }
  } catch (error) {
    console.error("Error al cargar productos:", error);
    Swal.fire("Error", "No se pudieron cargar los productos: " + error.message, "error");
  }
}

/*******************************************************
 * Inicialización (si es necesario)
 *******************************************************/
async function initSistemaVenta() {
  await loadProductos();
}

initSistemaVenta();

/*******************************************************
 * Exponer funciones globalmente
 *******************************************************/
window.descargarReportePDF = descargarReportePDF;

// Función para descargar el reporte PDF usando html2canvas
async function descargarReportePDF(idReporteCierre) {
  const idReporteNum = Number(idReporteCierre);
  const reporteQuery = query(
    collection(db, "reporteCierre"),
    where("idReporteCierre", "==", idReporteNum)
  );
  const reporteSnap = await getDocs(reporteQuery);
  if (reporteSnap.empty) {
    return Swal.fire("Error", "Reporte no encontrado.", "error");
  }
  let reporteHtml;
  reporteSnap.forEach((docSnap) => {
    const data = docSnap.data();
    reporteHtml = data.report;
  });
  
  // Creamos un contenedor temporal para capturar el reporte con margen
  const container = document.createElement("div");
  container.style.width = "900px";
  container.style.margin = "20px auto";
  container.style.padding = "20px";
  container.innerHTML = `<link rel="stylesheet" href="styles.css">` + reporteHtml;
  document.body.appendChild(container);

  // Usamos html2canvas para capturar el contenedor y generar el PDF
  html2canvas(container, { scale: 2 }).then((canvas) => {
    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    const margin = 10; // margen de 10mm
    const pdfWidth = pdf.internal.pageSize.getWidth() - margin * 2;
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, "PNG", margin, margin, pdfWidth, pdfHeight);
    pdf.save(`ReporteCierre_${idReporteNum}.pdf`);
    document.body.removeChild(container);
  });
}
