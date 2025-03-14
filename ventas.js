/*******************************************************
 * ventas.js - Lógica principal de Ventas con Firebase v9
 *******************************************************/
import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  query,
  orderBy,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  writeBatch,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

/************ Verificar Login ************/
document.addEventListener("DOMContentLoaded", () => {
  const loggedUser = localStorage.getItem("loggedUser");
  if (!loggedUser) {
    window.location.href = "login.html";
  }
});

/************ Variables Globales ************/
let productos = [];
let cart = [];
let datosCliente = {};

// Variables para control de caja
let cajaAbierta = false;
let idAperturaActivo = null;
let montoApertura = 0;
let datosApertura = {};

// Gestión de usuario y tienda
const loggedUser = localStorage.getItem("loggedUser") || "admin";
const loggedUserRole = localStorage.getItem("loggedUserRole") || "";
const loggedUserStore = localStorage.getItem("loggedUserStore") || "DefaultStore";
const isAdmin = (loggedUserRole.toLowerCase() === "admin");
let currentStore = "";
const usuarioActual = loggedUser;

/*******************************************************
 * Generar IDs Cortos (para ventas, aperturas, etc.)
 *******************************************************/
function generarIdCorto() {
  return Math.floor(Math.random() * 90000) + 10000;
}
function generarIdVentaCorta() {
  return Math.floor(Math.random() * 9000) + 1000;
}

/*******************************************************
 * Verificar si hay una caja abierta en la base de datos
 *******************************************************/
async function checkCajaAbierta() {
  try {
    const aperturasRef = collection(db, "aperturas");
    const qAperturas = query(
      aperturasRef,
      where("usuario", "==", usuarioActual),
      where("activo", "==", true)
    );
    const snapshot = await getDocs(qAperturas);
    if (!snapshot.empty) {
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        cajaAbierta = true;
        idAperturaActivo = docSnap.id;
        datosApertura = data;
      });
    }
  } catch (error) {
    console.error("Error al verificar caja abierta:", error);
  }
}

/*******************************************************
 * Configuración de la Interfaz al Cargar el DOM
 *******************************************************/
document.addEventListener("DOMContentLoaded", async () => {
  // Verificar si la caja ya está abierta en la base de datos
  await checkCajaAbierta();

  const invTitle = document.getElementById("inventoryTitle");
  if (isAdmin) {
    document.getElementById("adminStoreFilter").style.display = "block";
    invTitle.textContent = "Inventario: Stock Total";
    loadStoreFilter();
    document.getElementById("storeSelect").addEventListener("change", function () {
      currentStore = this.value;
      invTitle.textContent = currentStore ? `Inventario de: ${currentStore}` : "Inventario: Stock Total";
      listenProducts();
    });
  } else {
    currentStore = loggedUserStore;
    invTitle.textContent = `Inventario de: ${currentStore}`;
  }
  listenProducts();
  document.getElementById("searchInput").addEventListener("input", renderProducts);
  document.getElementById("sizeFilter").addEventListener("change", renderProducts);
});

/*******************************************************
 * Cargar Tiendas (para admin)
 *******************************************************/
async function loadStoreFilter() {
  try {
    const qStores = query(collection(db, "tiendas"), orderBy("nombre"));
    const snapshot = await getDocs(qStores);
    const storeSelect = document.getElementById("storeSelect");
    storeSelect.innerHTML = "<option value=''>Inventario: Stock Total</option>";
    snapshot.forEach((docSnap) => {
      const store = docSnap.data();
      const option = document.createElement("option");
      option.value = store.nombre;
      option.textContent = store.nombre;
      storeSelect.appendChild(option);
    });
  } catch (error) {
    console.error("Error al cargar tiendas:", error);
  }
}

/*******************************************************
 * Escuchar la colección "productos" en tiempo real
 *******************************************************/
function listenProducts() {
  const qProducts = query(collection(db, "productos"), orderBy("createdAt", "desc"));
  onSnapshot(
    qProducts,
    (snapshot) => {
      productos = [];
      snapshot.forEach((docSnap) => {
        let prod = docSnap.data();
        prod.id = docSnap.id;
        productos.push(prod);
      });
      renderProducts();
    },
    (error) => {
      console.error("Error en onSnapshot:", error);
      Swal.fire("Error", "No se pudieron obtener los productos: " + error.message, "error");
    }
  );
}

/*******************************************************
 * Renderizar Productos (filtrado por búsqueda, talla y tienda)
 *******************************************************/
function renderProducts() {
  const searchQuery = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const sizeFilter = (document.getElementById("sizeFilter")?.value || "").toLowerCase();
  const tbody = document.getElementById("productsBody");
  tbody.innerHTML = "";
  const filtered = productos.filter(prod => {
    let matchSearch =
      ((prod.codigo || "").toLowerCase().includes(searchQuery) ||
       (prod.descripcion || "").toLowerCase().includes(searchQuery));
    let matchSize = true;
    if (sizeFilter) {
      matchSize = ((prod.talla || "").toLowerCase() === sizeFilter);
    }
    return matchSearch && matchSize;
  });
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center">No hay productos con ese filtro</td></tr>`;
    return;
  }
  filtered.forEach(prod => {
    let stockDisplay = 0;
    if (prod.stock && typeof prod.stock === "object") {
      if (isAdmin) {
        stockDisplay = currentStore ? (prod.stock[currentStore] || 0)
                                      : Object.values(prod.stock).reduce((sum, val) => sum + Number(val), 0);
      } else {
        stockDisplay = prod.stock[currentStore] || 0;
      }
    } else {
      stockDisplay = prod.stock || 0;
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${prod.codigo}</td>
      <td>${prod.descripcion}</td>
      <td>${prod.talla || ""}</td>
      <td>Q ${parseFloat(prod.precio).toFixed(2)}</td>
      <td>${stockDisplay}</td>
      <td><button class="btn btn-primary btn-sm">Agregar</button></td>
    `;
    tr.addEventListener("click", () => {
      document.querySelectorAll("#productsBody tr").forEach(row => row.classList.remove("table-active"));
      tr.classList.add("table-active");
      selectedProductId = prod.id;
    });
    tr.querySelector("button").addEventListener("click", (e) => {
      e.stopPropagation();
      agregarProductoAlCarrito(prod.id);
    });
    tbody.appendChild(tr);
  });
}

/*******************************************************
 * Agregar Producto al Carrito
 *******************************************************/
async function agregarProductoAlCarrito(productId) {
  const prod = productos.find(p => p.id === productId);
  if (!prod) return;
  let stockDisponible = 0;
  if (prod.stock && typeof prod.stock === "object") {
    if (isAdmin) {
      stockDisponible = currentStore ? (prod.stock[currentStore] || 0)
                                      : Object.values(prod.stock).reduce((sum, val) => sum + Number(val), 0);
    } else {
      stockDisponible = prod.stock[currentStore] || 0;
    }
  } else {
    stockDisponible = prod.stock || 0;
  }
  const { value: cantidad } = await Swal.fire({
    title: "Cantidad a Agregar",
    input: "number",
    inputLabel: `Ingrese la cantidad (Stock disp: ${stockDisponible})`,
    inputAttributes: { min: 1, max: stockDisponible, step: 1 },
    inputValidator: (value) => {
      if (!value || value <= 0) return "Cantidad inválida";
      if (value > stockDisponible) return "La cantidad excede el stock disponible";
    }
  });
  if (cantidad) {
    let cantNum = parseInt(cantidad);
    let existing = cart.find(item => item.productId === prod.id);
    if (existing) {
      if (existing.cantidad + cantNum > stockDisponible) {
        Swal.fire("Error", "Cantidad total excede el stock", "error");
        return;
      }
      existing.cantidad += cantNum;
    } else {
      cart.push({
        productId: prod.id,
        producto: prod.descripcion,
        producto_codigo: prod.codigo || "N/A",
        cantidad: cantNum,
        precio: prod.precio
      });
    }
    Swal.fire("Producto agregado", "", "success");
    renderCart();
  }
}

/*******************************************************
 * Renderizar Carrito
 *******************************************************/
function renderCart() {
  const tbody = document.querySelector("#cartTable tbody");
  tbody.innerHTML = "";
  let total = 0;
  cart.forEach((item, idx) => {
    let subt = item.cantidad * item.precio;
    total += subt;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.producto}<br><small>${item.producto_codigo}</small></td>
      <td>${item.cantidad}</td>
      <td>Q ${item.precio.toFixed(2)}</td>
      <td>Q ${subt.toFixed(2)}</td>
      <td><button class="btn btn-danger btn-sm">❌</button></td>
    `;
    tr.querySelector("button").addEventListener("click", () => {
      cart.splice(idx, 1);
      renderCart();
    });
    tbody.appendChild(tr);
  });
  document.getElementById("totalVenta").textContent = total.toFixed(2);
}

/*******************************************************
 * Procesar Venta (Caja debe estar abierta)
 *******************************************************/
async function procesarVenta() {
  if (!cajaAbierta || !idAperturaActivo) {
    Swal.fire("Error", "Debes abrir la caja antes de vender.", "warning");
    return;
  }
  if (cart.length === 0) {
    Swal.fire("Carrito vacío", "", "warning");
    return;
  }
  // Paso preliminar: Seleccionar el tipo de venta (Tarjeta o En Línea)
  const { value: saleType } = await Swal.fire({
    title: "Seleccione el tipo de venta",
    input: "radio",
    inputOptions: {
      tarjeta: "Venta en Tarjeta",
      online: "Venta en Línea"
    },
    inputValidator: (value) => {
      if (!value) return "Seleccione un tipo de venta";
    }
  });
  if (!saleType) return;
  // Definir el método de pago por defecto según la elección
  const defaultMetodo = saleType === "tarjeta" ? "Tarjeta" : "En Línea";
  let totalVenta = parseFloat(document.getElementById("totalVenta").textContent) || 0;
  let resumenHtml = "";
  cart.forEach(item => {
    let subt = item.cantidad * item.precio;
    resumenHtml += `
      <p><strong>${item.producto}</strong> (${item.producto_codigo})<br>
         Cant: ${item.cantidad} x Q${item.precio.toFixed(2)} = Q${subt.toFixed(2)}</p>
    `;
  });
  resumenHtml += `<h4>Total: Q${totalVenta.toFixed(2)}</h4>`;
  const { value: formData } = await Swal.fire({
    title: "Procesar Venta",
    html: `
      <h4>Datos del Cliente</h4>
      <input type="text" id="clienteNombre" class="swal2-input" placeholder="Nombre y Apellido">
      <input type="text" id="clienteTelefono" class="swal2-input" placeholder="Teléfono">
      <input type="email" id="clienteCorreo" class="swal2-input" placeholder="Correo (opc)">
      <input type="text" id="clienteDireccion" class="swal2-input" placeholder="Dirección (opc)">
      <hr>
      <h4>Detalle de la Venta</h4>
      ${resumenHtml}
      <select id="metodoPago" class="swal2-select">
        <option value="Efectivo">Efectivo</option>
        <option value="Tarjeta" ${defaultMetodo === "Tarjeta" ? "selected" : ""}>Tarjeta</option>
        <option value="En Línea" ${defaultMetodo === "En Línea" ? "selected" : ""}>En Línea</option>
        <option value="Transferencia">Transferencia</option>
      </select>
      <div id="pagoEfectivoContainer">
        <input type="number" id="montoRecibido" class="swal2-input" value="${totalVenta}" placeholder="Monto recibido (Q)">
      </div>
    `,
    focusConfirm: false,
    preConfirm: () => {
      const nombre = document.getElementById("clienteNombre").value.trim();
      const telefono = document.getElementById("clienteTelefono").value.trim();
      if (!nombre) {
        Swal.showValidationMessage("El nombre es obligatorio");
        return;
      }
      if (!telefono) {
        Swal.showValidationMessage("El teléfono es obligatorio");
        return;
      }
      let clienteData = {
        nombre,
        telefono,
        correo: document.getElementById("clienteCorreo").value.trim(),
        direccion: document.getElementById("clienteDireccion").value.trim()
      };
      let metodo = document.getElementById("metodoPago").value;
      let pagoObj = { metodo };
      if (metodo === "Efectivo") {
        let montoRecibido = parseFloat(document.getElementById("montoRecibido").value);
        if (isNaN(montoRecibido) || montoRecibido < totalVenta) {
          Swal.showValidationMessage("Monto insuficiente para cubrir el total");
          return;
        }
        pagoObj.montoRecibido = montoRecibido;
        pagoObj.cambio = montoRecibido - totalVenta;
      }
      return { clienteData, pagoObj };
    },
    didOpen: () => {
      const metodoSelect = document.getElementById("metodoPago");
      const efectivoContEl = document.getElementById("pagoEfectivoContainer");
      metodoSelect.addEventListener("change", function () {
        efectivoContEl.style.display = this.value === "Efectivo" ? "block" : "none";
      });
    }
  });
  if (!formData) return;
  let ventaId = generarIdVentaCorta();
  let venta = {
    idVenta: ventaId,
    fecha: new Date().toISOString(),
    cliente: formData.clienteData,
    productos: cart.map(item => ({
      producto_id: item.productId,
      producto_nombre: item.producto,
      producto_codigo: item.producto_codigo,
      cantidad: item.cantidad,
      precio_unitario: item.precio,
      subtotal: item.cantidad * item.precio
    })),
    total: totalVenta,
    metodo_pago: formData.pagoObj.metodo,
    cambio: formData.pagoObj.cambio || 0,
    usuario: usuarioActual,
    idApertura: idAperturaActivo
  };
  const batch = writeBatch(db);
  for (let item of cart) {
    let prodRef = doc(db, "productos", item.productId);
    let prodSnap = await getDoc(prodRef);
    if (prodSnap.exists()) {
      let prodData = prodSnap.data();
      if (prodData.stock && typeof prodData.stock === "object") {
        if (isAdmin) {
          if (currentStore) {
            let stActual = prodData.stock[currentStore] || 0;
            prodData.stock[currentStore] = stActual - item.cantidad;
          }
        } else {
          let stActual = prodData.stock[currentStore] || 0;
          prodData.stock[currentStore] = stActual - item.cantidad;
        }
      } else {
        prodData.stock = (prodData.stock || 0) - item.cantidad;
      }
      batch.update(prodRef, { stock: prodData.stock });
    }
  }
  let ventaRef = doc(collection(db, "ventas"));
  batch.set(ventaRef, venta);
  try {
    await batch.commit();
    Swal.fire({
      title: "Venta procesada!",
      html: `
        <p>Comprobante generado.</p>
        <button class='btn btn-primary' onclick='descargarComprobante(${JSON.stringify(venta)})'>
          Descargar Comprobante
        </button>
      `,
      icon: "success"
    });
    cart = [];
    renderCart();
  } catch (error) {
    Swal.fire("Error", error.toString(), "error");
  }
}

/*******************************************************
 * Descargar Comprobante PDF
 *******************************************************/
function descargarComprobante(venta) {
  console.log("Comprobante PDF =>", venta);
  Swal.fire("PDF", "Pendiente implementar PDF con jsPDF", "info");
}

/*******************************************************
 * Apertura y Cierre de Caja (Persistente en BD)
 *******************************************************/
async function abrirCaja() {
  if (cajaAbierta) {
    Swal.fire("Error", "La caja ya está abierta.", "warning");
    return;
  }
  const { value: monto } = await Swal.fire({
    title: "Abrir Caja",
    input: "number",
    inputLabel: "Ingrese el monto inicial (Q)",
    inputValidator: (val) => {
      if (!val || parseFloat(val) <= 0) {
        return "Monto inválido";
      }
    }
  });
  if (!monto) return;
  montoApertura = parseFloat(monto);
  let now = new Date();
  let fecha = now.toISOString().split("T")[0];
  let hora = now.toTimeString().split(" ")[0];
  let idApertura = generarIdCorto();
  let apertura = {
    idApertura,
    fechaApertura: fecha,
    horaApertura: hora,
    montoApertura,
    usuario: usuarioActual,
    activo: true
  };
  try {
    const docRef = await addDoc(collection(db, "aperturas"), apertura);
    cajaAbierta = true;
    idAperturaActivo = docRef.id;
    datosApertura = apertura;
    Swal.fire("Caja Abierta", `Apertura registrada. Monto: Q${montoApertura.toFixed(2)}`, "success");
  } catch (error) {
    Swal.fire("Error", error.message, "error");
  }
}

async function cerrarCaja() {
  if (!cajaAbierta || !idAperturaActivo) {
    Swal.fire("Error", "No hay una apertura activa", "warning");
    return;
  }
  let fechaHoy = new Date().toISOString().split("T")[0];
  const { value: formCierre } = await Swal.fire({
    title: "Cerrar Caja",
    html: `
      <p>Fecha de cierre: ${fechaHoy}</p>
      <input type="number" id="montoFinal" class="swal2-input" placeholder="Monto final en caja (Q)">
    `,
    preConfirm: () => {
      const mf = parseFloat(document.getElementById("montoFinal").value);
      if (isNaN(mf)) {
        Swal.showValidationMessage("Monto final inválido");
      }
      return mf;
    }
  });
  if (formCierre === undefined) return;
  let montoFinal = parseFloat(formCierre) || 0;
  let qVentas = query(collection(db, "ventas"), where("idApertura", "==", idAperturaActivo));
  try {
    const snap = await getDocs(qVentas);
    let totalEfectivo = 0;
    let totalTarjeta = 0;
    let totalTransferencia = 0;
    let ventasDetalle = [];
    snap.forEach(docSnap => {
      let venta = docSnap.data();
      if (venta.metodo_pago?.toLowerCase() === "efectivo") {
        totalEfectivo += venta.total;
      } else if (venta.metodo_pago?.toLowerCase() === "tarjeta") {
        totalTarjeta += venta.total;
      } else if (venta.metodo_pago?.toLowerCase() === "transferencia") {
        totalTransferencia += venta.total;
      }
      ventasDetalle.push(venta);
    });
    let totalGeneral = totalEfectivo + totalTarjeta + totalTransferencia;
    let diferencia = montoFinal - totalGeneral;
    let now = new Date();
    let horaCierre = now.toTimeString().split(" ")[0];
    let cierreData = {
      idApertura: idAperturaActivo,
      fechaApertura: datosApertura.fechaApertura,
      horaApertura: datosApertura.horaApertura,
      fechaCierre: fechaHoy,
      horaCierre,
      totalEfectivo,
      totalTarjeta,
      totalTransferencia,
      totalGeneral,
      montoApertura,
      montoFinal,
      diferencia,
      usuario: usuarioActual
    };
    // Actualizar la apertura para marcarla como cerrada
    await updateDoc(doc(db, "aperturas", idAperturaActivo), { activo: false });
    await addDoc(collection(db, "cierres"), cierreData);
    cajaAbierta = false;
    idAperturaActivo = null;
    Swal.fire({
      title: "Cierre Registrado",
      html: generarReporteCierreHTML(ventasDetalle, cierreData),
      width: "80%"
    });
  } catch (error) {
    Swal.fire("Error", error.toString(), "error");
  }
}

function generarReporteCierreHTML(ventas, cierre) {
  let htmlReporte = `
    <div class="container">
      <div class="row mb-3">
        <div class="col-md-3 summary-box">
          <strong>Num. Apertura:</strong> ${cierre.idApertura}
        </div>
        <div class="col-md-3 summary-box">
          <strong>Nombre Cajero:</strong> ${cierre.usuario}
        </div>
        <div class="col-md-3 summary-box">
          <strong>Fecha Apertura:</strong> ${cierre.fechaApertura} ${cierre.horaApertura}
        </div>
        <div class="col-md-3 summary-box">
          <strong>Fecha Cierre:</strong> ${cierre.fechaCierre} ${cierre.horaCierre}
        </div>
      </div>
      <div class="row mb-3">
        <div class="col-md-4 summary-box bg-light">
          <strong>Fondo Apertura:</strong> Q ${cierre.montoApertura.toFixed(2)}
        </div>
        <div class="col-md-4 summary-box bg-light">
          <strong>Venta Total:</strong> Q ${cierre.totalGeneral.toFixed(2)}
        </div>
        <div class="col-md-4 summary-box bg-light">
          <strong>Venta Efectivo:</strong> Q ${cierre.totalEfectivo.toFixed(2)}
        </div>
      </div>
      <div class="row mb-3">
        <div class="col-md-6 summary-box bg-light">
          <strong>Venta Tarjeta:</strong> Q ${cierre.totalTarjeta.toFixed(2)}
        </div>
        <div class="col-md-6 summary-box bg-light">
          <strong>Venta Transferencia:</strong> Q ${cierre.totalTransferencia.toFixed(2)}
        </div>
      </div>
      <div class="row mb-3">
        <div class="col-md-6 summary-box bg-light">
          <strong>Total Sistema:</strong> Q ${cierre.totalGeneral.toFixed(2)}
        </div>
        <div class="col-md-6 summary-box bg-light">
          <strong>Total Cajero:</strong> Q ${cierre.montoFinal.toFixed(2)}
        </div>
      </div>
      <div class="row mb-3">
        <div class="col-md-12 summary-box bg-light">
          <strong>Diferencia de Caja:</strong> Q ${cierre.diferencia.toFixed(2)}
        </div>
      </div>
      <h4>Detalles de Operaciones</h4>
      <table class="table table-bordered">
        <thead>
          <tr>
            <th>N° Documento</th>
            <th>Forma de Pago</th>
            <th>Monto Pagado</th>
            <th>Equivalencia en Caja</th>
          </tr>
        </thead>
        <tbody>`;
  ventas.forEach(v => {
    let equivalencia = (v.metodo_pago?.toLowerCase() === "efectivo")
      ? `Q ${parseFloat(v.total).toFixed(2)}`
      : "-";
    htmlReporte += `
          <tr>
            <td>${v.id}</td>
            <td>${v.metodo_pago}</td>
            <td>Q ${parseFloat(v.total).toFixed(2)}</td>
            <td>${equivalencia}</td>
          </tr>`;
  });
  htmlReporte += `
        </tbody>
      </table>
      <br>
      <button class="btn btn-primary" onclick="descargarReporteCierre(
        ${encodeURIComponent(JSON.stringify(ventas))},
        ${encodeURIComponent(JSON.stringify(cierre))}
      )">Descargar Reporte PDF</button>
    </div>`;
  return htmlReporte;
}

function descargarReporteCierre(ventasJSON, cierreJSON) {
  const ventas = JSON.parse(decodeURIComponent(ventasJSON));
  const cierre = JSON.parse(decodeURIComponent(cierreJSON));
  Swal.fire("PDF", "Reporte de Cierre en PDF por implementar", "info");
}

/*******************************************************
 * Inicialización del Sistema de Ventas
 *******************************************************/
async function initSistemaVenta() {
  await loadProductos();
}

/*******************************************************
 * Cargar Productos
 *******************************************************/
async function loadProductos() {
  try {
    const cProductos = collection(db, "productos");
    const qProds = query(cProductos, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(qProds);
    productos = [];
    snapshot.forEach(docSnap => {
      let prod = docSnap.data();
      prod.id = docSnap.id;
      productos.push(prod);
    });
    renderProducts();
  } catch (error) {
    console.error("Error al cargar productos:", error);
    Swal.fire("Error", "No se pudieron cargar los productos: " + error.message, "error");
  }
}

/*******************************************************
 * Exponer funciones globalmente para ser usadas en HTML
 *******************************************************/
window.abrirCaja = abrirCaja;
window.procesarVenta = procesarVenta;
window.cerrarCaja = cerrarCaja;
window.descargarComprobante = descargarComprobante;
