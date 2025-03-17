import { db } from "./firebase-config.js";
import { collection, query, where, orderBy, getDocs, getDoc, updateDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

const loggedUserRole = (localStorage.getItem("loggedUserRole") || "").toLowerCase();
let tablaCierres;
//hOLA//
$(document).ready(function () {
  tablaCierres = $("#tablaCierres").DataTable({
    language: { url: "https://cdn.datatables.net/plug-ins/1.13.4/i18n/es-ES.json" },
    order: [[0, "desc"]],
    responsive: true
  });
  cargarCierres();
  $("#filtroFecha").on("change", cargarCierres);
});
async function cargarCierres() {
    const filtroFecha = document.getElementById("filtroFecha").value;
    let cierresQuery = filtroFecha ?
      query(collection(db, "cierres"), where("fechaCierre", "==", filtroFecha)) :
      query(collection(db, "cierres"), orderBy("fechaCierre", "desc"));
  
    const snapshot = await getDocs(cierresQuery);
    tablaCierres.clear();
  
    snapshot.forEach((docSnap) => {
      const cierre = docSnap.data();
      cierre.id = docSnap.id;
  
      const fechaHora = `${cierre.fechaCierre} ${cierre.horaCierre || ""}`;
  
      // ✅ Recalcular la diferencia como (Monto Apertura + Total Efectivo) - Total Ingresado
      const montoApertura = Number(cierre.montoApertura || 0);
      const totalEfectivo = Number(cierre.totalEfectivo || 0);
      const totalIngresado = Number(cierre.totalIngresado || 0);
      const diferenciaCalculada = (montoApertura + totalEfectivo) - totalIngresado;
  
      // ✅ Acciones
      let acciones = `<button class="btn btn-sm btn-info" onclick="verDetalleCierre('${docSnap.id}')">VER</button>`;
      if (loggedUserRole === "admin") {
        acciones += ` <button class="btn btn-sm btn-warning" onclick="anularCierre('${docSnap.id}')">ANULAR</button>`;
        acciones += ` <button class="btn btn-sm btn-danger" onclick="eliminarCierre('${docSnap.id}')">ELIMINAR</button>`;
      }
  
      // ✅ Agregar fila a la tabla con los datos ajustados
      tablaCierres.row.add([
        fechaHora,
        cierre.usuario,
        "Q " + Number(cierre.totalGeneral || 0).toFixed(2),
        "Q " + montoApertura.toFixed(2),
        // "Q " + Number(cierre.totalEfectivo || 0).toFixed(2), // Si quieres puedes volver a activarlo
        // "Q " + Number(cierre.totalTarjeta || 0).toFixed(2),  // Si quieres puedes volver a activarlo
        "Q " + Number(cierre.totalEfectivoSistema || 0).toFixed(2),
        "Q " + totalIngresado.toFixed(2),
        "Q " + diferenciaCalculada.toFixed(2), // ✅ Mostrar la diferencia calculada
        acciones
      ]);
    });
  
    tablaCierres.draw();
  }
  
window.verDetalleCierre = async function (cierreId) {
  const cierreDoc = await getDoc(doc(db, "cierres", cierreId));
  if (!cierreDoc.exists()) return Swal.fire("Error", "Cierre no encontrado.", "error");

  const cierre = cierreDoc.data();
  const ventasQuery = query(collection(db, "ventas"), where("idApertura", "==", cierre.idApertura));
  const ventasSnapshot = await getDocs(ventasQuery);

  let totalEfectivo = 0, totalTarjeta = 0, totalTransferencia = 0, totalLinea = 0;
  let ventasDetalle = "";

  ventasSnapshot.forEach((v, index) => {
    const venta = v.data();
    const monto = Number(venta.total || 0);
    const metodo = venta.metodo_pago?.toLowerCase();

    if (metodo === "efectivo") totalEfectivo += monto;
    else if (metodo === "tarjeta") totalTarjeta += monto;
    else if (metodo === "transferencia") totalTransferencia += monto;
    else if (metodo === "en línea" || metodo === "en linea") totalLinea += monto;

    ventasDetalle += `
      <tr><td>${venta.idVenta || index + 1}</td><td>${venta.metodo_pago || '-'}</td><td>Q ${monto.toFixed(2)}</td><td>${venta.empleadoNombre || '-'}</td></tr>`;
  });

  const totalGeneralVentas = totalEfectivo + totalTarjeta + totalTransferencia + totalLinea;

  // ✅ Ajustes específicos
  const totalEfectivoSistema = (Number(cierre.montoApertura || 0) + totalEfectivo).toFixed(2);
  const totalIngresado = Number(cierre.totalIngresado || 0).toFixed(2);
  const diferencia = (totalEfectivoSistema - totalIngresado).toFixed(2);
  const colorDiferencia = diferencia < 0 ? 'text-rojo' : 'text-verde';

  const detalleHTML = `
    <div>
      <div style="display: flex; justify-content: space-between;">
        <div><strong>Monto de Apertura:</strong> Q ${Number(cierre.montoApertura || 0).toFixed(2)}</div>
        <div>
          <strong>Fecha:</strong> ${cierre.fechaCierre} ${cierre.horaCierre || ''}<br>
          <strong>Lugar:</strong> ${cierre.usuario}
        </div>
      </div>

      <h5 class="mt-3">Resumen de Ventas</h5>
      <table class="table table-bordered">
        <thead><tr><th>Venta Efectivo</th><th>Venta Tarjeta</th><th>Venta Transferencia</th><th>Venta en Línea</th></tr></thead>
        <tbody><tr>
          <td>Q ${totalEfectivo.toFixed(2)}</td>
          <td>Q ${totalTarjeta.toFixed(2)}</td>
          <td>Q ${totalTransferencia.toFixed(2)}</td>
          <td>Q ${totalLinea.toFixed(2)}</td>
        </tr></tbody>
      </table>

      <table class="table table-bordered">
        <thead><tr><th>Venta Total</th></tr></thead>
        <tbody><tr><td>Q ${totalGeneralVentas.toFixed(2)}</td></tr></tbody>
      </table>

      <h5 class="mt-3">Totales</h5>
      <table class="table table-bordered">
        <thead><tr><th>Total Efectivo (Sistema)</th><th>Total Ingresado (Arqueo Físico)</th><th>Diferencia</th></tr></thead>
        <tbody><tr>
          <td>Q ${totalEfectivoSistema}</td>
          <td>Q ${totalIngresado}</td>
          <td><span class="${colorDiferencia}">Q ${diferencia}</span></td>
        </tr></tbody>
      </table>

      <h5 class="mt-3">Ventas Detalladas</h5>
      <table class="table table-bordered">
        <thead><tr><th># Documento</th><th>Forma de Pago</th><th>Monto (Q)</th><th>Vendedor</th></tr></thead>
        <tbody>${ventasDetalle || '<tr><td colspan="4">No se encontraron ventas</td></tr>'}</tbody>
      </table>
    </div>`;

  Swal.fire({ title: "Detalle del Cierre", html: detalleHTML, width: "90%" });
};

window.anularCierre = async (id) => { await updateDoc(doc(db, "cierres", id), { estado: "ANULADA" }); cargarCierres(); };
window.eliminarCierre = async (id) => { await deleteDoc(doc(db, "cierres", id)); cargarCierres(); };
