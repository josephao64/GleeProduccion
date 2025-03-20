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
  onSnapshot,
  limit
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
 * Formatear Fecha a dd/mm/yyyy
 *******************************************************/
function formatDate(date) {
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

/*******************************************************
 * Función parseDate
 * Se encarga de interpretar una fecha en formato ISO o dd/mm/yyyy
 *******************************************************/
function parseDate(dateString) {
  // Intenta parsear como fecha ISO
  const iso = Date.parse(dateString);
  if (!isNaN(iso)) {
    return new Date(dateString);
  }
  // Si no es ISO, asume dd/mm/yyyy
  const parts = dateString.split("/");
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    return new Date(year, month, day);
  }
  return new Date();
}

/*******************************************************
 * Función para descargar el comprobante en PDF
 * utilizando jsPDF
 *******************************************************/
function descargarComprobante(venta) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("Comprobante de Venta", 10, 20);
  doc.setFontSize(12);
  const fecha = new Date(venta.fecha);
  doc.text("Fecha: " + fecha.toLocaleString(), 10, 30);
  doc.text("ID Venta: " + venta.idVenta, 10, 40);
  doc.text("Cliente: " + (venta.cliente.nombre || "N/A"), 10, 50);
  let posY = 60;
  venta.productos.forEach((item, idx) => {
    doc.text(
      `${idx + 1}. ${item.producto_nombre} x${item.cantidad} - Q${item.subtotal.toFixed(2)}`,
      10,
      posY
    );
    posY += 10;
  });
  doc.text("Total: Q" + venta.total.toFixed(2), 10, posY + 10);
  doc.save("comprobante.pdf");
}

/*******************************************************
 * Obtener el próximo número de apertura de forma incremental
 *******************************************************/
async function getNextAperturaId() {
  try {
    const aperturasRef = collection(db, "aperturas");
    const q = query(aperturasRef, orderBy("idApertura", "desc"), limit(1));
    const snapshot = await getDocs(q);
    let nextId = 1;
    if (!snapshot.empty) {
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        nextId = parseInt(data.idApertura) + 1;
      });
    }
    return nextId;
  } catch (error) {
    console.error("Error al obtener el próximo número de apertura:", error);
    return generarIdCorto();
  }
}

/*******************************************************
 * Función para obtener el nombre del empleado según su código
 *******************************************************/
async function getEmployeeName(codigo) {
  try {
    const empleadosRef = collection(db, "empleados");
    const q = query(empleadosRef, where("codigo", "==", codigo.toUpperCase()));
    const snapshot = await getDocs(q);
    let empName = "";
    if (!snapshot.empty) {
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        empName = data.nombre;
      });
    }
    return empName || codigo;
  } catch (error) {
    console.error("Error al obtener nombre de empleado:", error);
    return codigo;
  }
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
      <td>Q ${parseFloat(prod.precio || 0).toFixed(2)}</td>
      <td>${stockDisplay}</td>
      <td><button class="btn btn-primary btn-sm">Agregar</button></td>
    `;
    tr.addEventListener("click", () => {
      document.querySelectorAll("#productsBody tr").forEach(row =>
        row.classList.remove("table-active")
      );
      tr.classList.add("table-active");
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
 * Procesar Venta
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
  if (isAdmin && !currentStore) {
    Swal.fire("Error", "Seleccione una tienda para descontar stock.", "error");
    return;
  }
  const { value: saleCategory } = await Swal.fire({
    title: "Tipo de Venta",
    input: "radio",
    inputOptions: {
      fisico: "Venta Física",
      online: "Venta en Línea"
    },
    inputValidator: (value) => {
      if (!value) return "Seleccione un tipo de venta";
    }
  });
  if (!saleCategory) return;

  const { value: empCodigo } = await Swal.fire({
    title: "Código del Empleado",
    input: "text",
    inputLabel: "Ingrese el código del empleado (3 caracteres)",
    inputAttributes: {
      maxlength: 3,
      pattern: "^[A-Za-z0-9]{3}$",
      placeholder: "ABC"
    },
    inputValidator: (value) => {
      if (!value || !/^[A-Za-z0-9]{3}$/.test(value)) {
        return "El código debe tener 3 caracteres alfanuméricos";
      }
    }
  });
  if (!empCodigo) return;

  const empNombre = await getEmployeeName(empCodigo);

  let totalVenta = parseFloat(document.getElementById("totalVenta").textContent) || 0;
  let resumenHtml = "";
  cart.forEach(item => {
    let subt = item.cantidad * item.precio;
    resumenHtml += `
      <p><strong>${item.producto}</strong> (${item.producto_codigo})<br>
         Cant: ${item.cantidad} x Q${item.precio.toFixed(2)} = Q${subt.toFixed(2)}</p>
    `;
  });
  resumenHtml += `<h4>Venta Total: Q${totalVenta.toFixed(2)}</h4>`;

  let formData;
  if (saleCategory === "fisico") {
    const result = await Swal.fire({
      title: "Procesar Venta - Física",
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
          <option value="Tarjeta">Tarjeta</option>
          <option value="Transferencia">Transferencia</option>
        </select>
        <div id="pagoEfectivoContainer">
          <input type="number" id="montoRecibido" class="swal2-input" value="${totalVenta}" placeholder="Monto recibido (Q)">
        </div>
        <div id="numeroTransferenciaContainer" style="display: none;">
          <input type="text" id="numeroTransferencia" class="swal2-input" placeholder="Número de Referencia">
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
          let montoRecibido = parseFloat(document.getElementById("montoRecibido").value) || 0;
          if (montoRecibido < totalVenta) {
            Swal.showValidationMessage("Monto insuficiente para cubrir el total");
            return;
          }
          pagoObj.montoRecibido = montoRecibido;
          pagoObj.cambio = montoRecibido - totalVenta;
        }
        if (metodo === "Transferencia") {
          let numTransferencia = document.getElementById("numeroTransferencia").value.trim();
          if (!numTransferencia) {
            Swal.showValidationMessage("Ingrese el número de Referencia");
            return;
          }
          pagoObj.numeroTransferencia = numTransferencia;
        }
        return { clienteData, pagoObj };
      },
      didOpen: () => {
        const metodoSelect = document.getElementById("metodoPago");
        const efectivoContEl = document.getElementById("pagoEfectivoContainer");
        const transferenciaContEl = document.getElementById("numeroTransferenciaContainer");
        metodoSelect.addEventListener("change", function () {
          if (this.value === "Efectivo") {
            efectivoContEl.style.display = "block";
            transferenciaContEl.style.display = "none";
          } else if (this.value === "Transferencia") {
            efectivoContEl.style.display = "none";
            transferenciaContEl.style.display = "block";
          } else {
            efectivoContEl.style.display = "none";
            transferenciaContEl.style.display = "none";
          }
        });
      }
    });
    formData = result.value;
  } else {
    const result = await Swal.fire({
      title: "Procesar Venta - En Línea",
      html: `
        <h4>Datos del Cliente</h4>
        <input type="text" id="clienteNombre" class="swal2-input" placeholder="Nombre y Apellido">
        <input type="text" id="clienteTelefono" class="swal2-input" placeholder="Teléfono">
        <input type="email" id="clienteCorreo" class="swal2-input" placeholder="Correo (opc)">
        <input type="text" id="clienteDireccion" class="swal2-input" placeholder="Dirección (opc)">
        <hr>
        <h4>Detalle de la Venta</h4>
        ${resumenHtml}
        <input type="text" id="comprobantePago" class="swal2-input" placeholder="Comprobante de Pago">
        <textarea id="comentarioVenta" class="swal2-textarea" placeholder="Comentario (opcional)"></textarea>
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
        let comprobante = document.getElementById("comprobantePago").value.trim();
        if (!comprobante) {
          Swal.showValidationMessage("El comprobante de pago es obligatorio");
          return;
        }
        let clienteData = {
          nombre,
          telefono,
          correo: document.getElementById("clienteCorreo").value.trim(),
          direccion: document.getElementById("clienteDireccion").value.trim()
        };
        let pagoObj = {
          metodo: "En Línea",
          comprobante,
          comentario: document.getElementById("comentarioVenta").value.trim()
        };
        return { clienteData, pagoObj };
      }
    });
    formData = result.value;
  }
  if (!formData) return;
  
  // Construir la venta
  let venta = {
    idVenta: generarIdVentaCorta(),
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
    idApertura: idAperturaActivo,
    empleadoNombre: empNombre,
    numeroTransferencia: formData.pagoObj.numeroTransferencia || ""
  };
  
  // Actualizar el stock mediante batch
  const batch = writeBatch(db);
  for (let item of cart) {
    let prodRef = doc(db, "productos", item.productId);
    let prodSnap = await getDoc(prodRef);
    if (prodSnap.exists()) {
      let prodData = prodSnap.data();
      if (prodData.stock && typeof prodData.stock === "object") {
        if (isAdmin && currentStore) {
          let stActual = prodData.stock[currentStore] || 0;
          prodData.stock[currentStore] = stActual - item.cantidad;
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
    // Mostrar el comprobante generado en un modal y permitir la descarga
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
 * Apertura y Cierre de Caja (Persistente en BD)
 *******************************************************/
async function abrirCaja() {
  if (cajaAbierta) {
    Swal.fire("Error", "La caja ya está abierta.", "warning");
    return;
  }
  const nextAperturaId = await getNextAperturaId();
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
  montoApertura = parseInt(monto);
  let now = new Date();
  let fecha = now.toISOString().split("T")[0];
  let hora = now.toTimeString().split(" ")[0];
  let idApertura = nextAperturaId; // Ejemplo: 29845
  let apertura = {
    idApertura, // Número incremental
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
    Swal.fire("Caja Abierta", `Apertura registrada. Fondo: Q ${montoApertura.toFixed(2)} (N° Apertura: ${idApertura})`, "success");
  } catch (error) {
    Swal.fire("Error", error.message, "error");
  }
}

async function cerrarCaja() {
  if (!cajaAbierta || !idAperturaActivo) {
    Swal.fire("Error", "No hay una apertura activa", "warning");
    return;
  }
  // Obtener la fecha actual en formato dd/mm/yyyy
  let fechaHoy = formatDate(new Date());
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

  // Consultar ventas asociadas a la apertura activa
  let qVentas = query(
    collection(db, "ventas"),
    where("idApertura", "==", idAperturaActivo)
  );
  try {
    const snap = await getDocs(qVentas);
    let totalEfectivo = 0, totalTarjeta = 0, totalTransferencia = 0, ventaLinea = 0;
    let ventasDetalle = [];
    snap.forEach(docSnap => {
      let venta = docSnap.data();
      let metodo = venta.metodo_pago.toLowerCase();
      if (metodo === "efectivo") {
        totalEfectivo += Number(venta.total || 0);
      } else if (metodo === "tarjeta") {
        totalTarjeta += Number(venta.total || 0);
      } else if (metodo === "transferencia") {
        totalTransferencia += Number(venta.total || 0);
      } else if (metodo === "en línea" || metodo === "en linea") {
        ventaLinea += Number(venta.total || 0);
      }
      ventasDetalle.push(venta);
    });
    let totalGeneral = totalEfectivo + totalTarjeta + totalTransferencia + ventaLinea;
    const totalEfectivoSistema = Number(montoApertura) + totalEfectivo;
    const totalIngresado = montoFinal;
    const diferencia = totalIngresado - totalEfectivoSistema;
    let now = new Date();
    let horaCierre = now.toTimeString().split(" ")[0];
    // Generar idReporteCierre (número)
    let idReporteCierre = generarIdCorto();
    let cierreData = {
      idCierre: datosApertura.idApertura, // Usamos el número de apertura
      idReporteCierre, // Nuevo campo para el reporte
      idApertura: datosApertura.idApertura,
      idAperturaNum: datosApertura.idApertura || 0,
      fechaApertura: datosApertura.fechaApertura,
      horaApertura: datosApertura.horaApertura,
      fechaCierre: fechaHoy,
      horaCierre,
      lugar: currentStore || "Local",
      montoApertura: datosApertura.montoApertura,
      totalEfectivo,
      totalTarjeta,
      totalTransferencia,
      ventaLinea,
      totalGeneral,
      totalEfectivoSistema,
      totalIngresado,
      diferencia,
      usuario: usuarioActual
    };

    await updateDoc(doc(db, "aperturas", idAperturaActivo), { activo: false });
    await addDoc(collection(db, "cierres"), cierreData);

    // Generar el reporte HTML con el nuevo formato
    const reporteHtml = generarReporteCierreHTML(ventasDetalle, cierreData);
    // Guardar el reporte en la colección "reporteCierre"
    await addDoc(collection(db, "reporteCierre"), {
      idReporteCierre,
      report: reporteHtml,
      fechaCierre: cierreData.fechaCierre,
      createdAt: new Date().toISOString()
    });

    cajaAbierta = false;
    idAperturaActivo = null;
    // Mostrar el reporte en el mismo modal sin redirigir
    Swal.fire({
      title: "Cierre Registrado",
      html: reporteHtml,
      width: "80%"
    });
  } catch (error) {
    Swal.fire("Error", error.toString(), "error");
  }
}

/*******************************************************
 * Generar Reporte de Cierre (HTML)
 *******************************************************/
function generarReporteCierreHTML(ventas, cierre) {
  // Calcular diferencia: Diferencia = Arqueo - Total efectivo (donde Total efectivo = montoApertura + totalEfectivo)
  const diff = Number(cierre.totalIngresado || 0) - Number(cierre.totalEfectivoSistema || 0);
  const colorDiferencia = diff >= 0 ? "green" : "red";
  // Se formatea la fecha de cierre usando parseDate y formatDate
  const fechaFormateada = cierre.fechaCierre ? formatDate(parseDate(cierre.fechaCierre)) : "Fecha no disponible";

  // Resumen de ventas por método
  const efectivo = Number(cierre.totalEfectivo || 0);
  const tarjeta = Number(cierre.totalTarjeta || 0);
  const transferencia = Number(cierre.totalTransferencia || 0);
  const enLinea = Number(cierre.ventaLinea || 0);
  const totalResumen = efectivo + tarjeta + transferencia + enLinea;
  
  // Total efectivo se calcula como: montoApertura + totalEfectivo
  const totalEfectivoSistema = Number(cierre.totalEfectivoSistema || 0);
  const arqueo = Number(cierre.totalIngresado || 0);
  const sumaTotalEfectivo = totalEfectivoSistema + arqueo;

  return `
    <div class="container" style="max-width: 900px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <!-- Encabezado -->
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
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">
              Q ${Number(totalEfectivoSistema).toFixed(2)} + Q ${Number(arqueo).toFixed(2)} = Q ${Number(sumaTotalEfectivo).toFixed(2)}
            </td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">Q ${Number(arqueo).toFixed(2)}</td>
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
          ${ventas.length > 0 ? ventas.map((v, index) => `
            <tr>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${v.idVenta || index + 1}</td>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${v.metodo_pago || "-"}</td>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${
                (v.metodo_pago && v.metodo_pago.trim().toLowerCase() === "transferencia")
                  ? (v.numeroTransferencia || "-")
                  : "-"
              }</td>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">Q ${Number(v.total || 0).toFixed(2)}</td>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${v.empleadoNombre || "-"}</td>
            </tr>
          `).join("") : `<tr><td colspan="5" class="text-center">No se encontraron ventas</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
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
 * Inicialización del Sistema de Ventas
 *******************************************************/
async function initSistemaVenta() {
  await loadProductos();
}

/*******************************************************
 * Exponer funciones globalmente para ser usadas en HTML
 *******************************************************/
window.abrirCaja = abrirCaja;
window.procesarVenta = procesarVenta;
window.cerrarCaja = cerrarCaja;
window.descargarComprobante = descargarComprobante;

/*******************************************************
 * Función para descargar el reporte PDF usando html2canvas
 *******************************************************/
window.descargarReportePDF = descargarReportePDF;
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

initSistemaVenta();
