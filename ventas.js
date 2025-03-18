<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sistema de Ventas con Apertura y Cierre de Caja (Firebase v9)</title>
    <!-- Bootstrap CSS -->
    <link
      href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"
      rel="stylesheet"
    />
    <!-- SweetAlert2 -->
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <!-- jQuery (opcional) -->
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <!-- jsPDF para generación de PDF -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <style>
      body {
        padding: 20px;
      }
      .summary-box {
        border: 1px solid #ddd;
        padding: 10px;
        border-radius: 5px;
        margin-bottom: 10px;
      }
      .bg-light {
        background-color: #f8f9fa !important;
      }
      .table-active {
        background-color: #d1ecf1 !important;
      }
      .filter-group {
        margin-bottom: 15px;
      }
    </style>
  </head>
  <body>
    <div class="container-fluid">
      <div class="row">
        <!-- Lado Izquierdo: Carrito y Control de Caja -->
        <div class="col-md-5 border-end">
          <h2>Carrito de Venta</h2>
          <table class="table table-sm" id="cartTable">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cant.</th>
                <th>Precio Unitario (Q)</th>
                <th>Subtotal (Q)</th>
                <th>Remover</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
          <h4>Total: Q <span id="totalVenta">0.00</span></h4>
          <button class="btn btn-success mt-2" onclick="procesarVenta()">Procesar Venta</button>
          <hr />
          <!-- Apertura y Cierre de Caja -->
          <button class="btn btn-warning mt-2" onclick="abrirCaja()">Abrir Caja</button>
          <button class="btn btn-danger mt-2" onclick="cerrarCaja()">Cerrar Caja</button>
        </div>
        <!-- Lado Derecho: Productos Disponibles -->
        <div class="col-md-7">
          <h2>Productos Disponibles</h2>
          <!-- Filtro de tienda (visible solo para admin) -->
          <div id="adminStoreFilter" class="mb-3" style="display: none;">
            <label for="storeSelect" class="form-label">Filtrar por tienda:</label>
            <select id="storeSelect" class="form-select">
              <option value="">Inventario: Stock Total</option>
            </select>
          </div>
          <!-- Título del inventario -->
          <h4 id="inventoryTitle">Inventario: Stock Total</h4>
          <!-- Buscador de productos -->
          <div class="filter-group">
            <input
              type="text"
              id="searchInput"
              class="form-control"
              placeholder="Buscar por código o descripción"
            />
          </div>
          <!-- Filtro por Talla -->
          <div class="filter-group">
            <select id="sizeFilter" class="form-select">
              <option value="">Todas las tallas</option>
              <option value="S">S</option>
              <option value="M">M</option>
              <option value="L">L</option>
              <option value="XL">XL</option>
            </select>
          </div>
          <table class="table table-bordered" id="productsTable">
            <thead class="table-light">
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>Talla</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody id="productsBody">
              <!-- Los productos se renderizarán dinámicamente -->
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Bootstrap JS Bundle -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <!-- Script de Ventas -->
    <script type="module">
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

      // Verificar Login
      document.addEventListener("DOMContentLoaded", () => {
        const loggedUser = localStorage.getItem("loggedUser");
        if (!loggedUser) {
          window.location.href = "login.html";
        }
      });

      // Variables Globales
      let productos = [];
      let cart = [];
      let datosCliente = {};

      // Variables para control de caja
      let cajaAbierta = false;
      let idAperturaActivo = null; // ID único del documento de apertura
      let montoApertura = 0;
      let datosApertura = {};

      // Gestión de usuario y tienda
      const loggedUser = localStorage.getItem("loggedUser") || "admin";
      const loggedUserRole = localStorage.getItem("loggedUserRole") || "";
      const loggedUserStore = localStorage.getItem("loggedUserStore") || "DefaultStore";
      const isAdmin = (loggedUserRole.toLowerCase() === "admin");
      let currentStore = "";
      const usuarioActual = loggedUser;

      // Funciones para generar IDs cortos
      function generarIdCorto() {
        return Math.floor(Math.random() * 90000) + 10000;
      }
      function generarIdVentaCorta() {
        return Math.floor(Math.random() * 9000) + 1000;
      }

      // Obtener el próximo número de apertura de forma incremental
      async function getNextAperturaId() {
        try {
          const aperturasRef = collection(db, "aperturas");
          const q = query(aperturasRef, orderBy("idAperturaNum", "desc"), limit(1));
          const snapshot = await getDocs(q);
          let nextId = 1;
          if (!snapshot.empty) {
            snapshot.forEach((docSnap) => {
              const data = docSnap.data();
              nextId = parseInt(data.idAperturaNum) + 1;
            });
          }
          return nextId;
        } catch (error) {
          console.error("Error al obtener el próximo número de apertura:", error);
          return generarIdCorto();
        }
      }

      // Obtener el nombre del empleado según su código
      // Retorna null si no se encuentra el empleado
      async function getEmployeeName(codigo) {
        try {
          const empleadosRef = collection(db, "empleados");
          const q = query(empleadosRef, where("codigo", "==", codigo.toUpperCase()));
          const snapshot = await getDocs(q);
          if (snapshot.empty) {
            return null;
          }
          let empName = "";
          snapshot.forEach(docSnap => {
            const data = docSnap.data();
            empName = data.nombre;
          });
          return empName;
        } catch (error) {
          console.error("Error al obtener nombre de empleado:", error);
          return null;
        }
      }

      // Verificar si hay una caja abierta en la BD
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

      // Configuración de la interfaz al cargar el DOM
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

      // Cargar tiendas para admin
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

      // Escuchar la colección "productos" en tiempo real
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

      // Renderizar productos (filtrado)
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

      // Agregar producto al carrito
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

      // Renderizar el carrito
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

      // Procesar la venta
      async function procesarVenta() {
        if (!cajaAbierta || !idAperturaActivo) {
          Swal.fire("Error", "Debes abrir la caja antes de vender.", "warning");
          return;
        }
        if (cart.length === 0) {
          Swal.fire("Carrito vacío", "", "warning");
          return;
        }
        // Para admin es obligatorio seleccionar una tienda
        if (isAdmin && !currentStore) {
          Swal.fire("Error", "Seleccione una tienda para descontar stock.", "error");
          return;
        }
        // Preguntar tipo de venta
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

        // Solicitar y validar código del empleado
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

        // Verificar existencia del empleado
        const empNombre = await getEmployeeName(empCodigo);
        if (empNombre === null) {
          Swal.fire("Error", "El código de empleado no existe.", "error");
          return;
        }

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
                <input type="text" id="numeroTransferencia" class="swal2-input" placeholder="Número de Transferencia">
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
                  Swal.showValidationMessage("Ingrese el número de transferencia");
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

        // Construir la venta, vinculándola con la apertura actual
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
          empleadoNombre: empNombre
        };

        // Actualizar el stock de productos mediante batch
        const batch = writeBatch(db);
        for (let item of cart) {
          let prodRef = doc(db, "productos", item.productId);
          let prodSnap = await getDoc(prodRef);
          if (prodSnap.exists()) {
            let prodData = prodSnap.data();
            if (prodData.stock && typeof prodData.stock === "object") {
              if (currentStore) {
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

      // Descargar comprobante PDF
      function descargarComprobante(venta) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        let y = 10;
        const lineHeight = 10;

        // Encabezado
        doc.setFontSize(16);
        doc.text("Comprobante de Venta", 10, y);
        y += lineHeight * 1.5;
        doc.setFontSize(12);
        doc.text(`Venta ID: ${venta.idVenta}`, 10, y);
        y += lineHeight;
        doc.text(`Fecha: ${new Date(venta.fecha).toLocaleString()}`, 10, y);
        y += lineHeight;
        doc.text(`Cajero: ${venta.usuario}`, 10, y);
        y += lineHeight;
        doc.text(`Empleado: ${venta.empleadoNombre}`, 10, y);

        // Datos del Cliente
        y += lineHeight * 1.5;
        doc.setFontSize(14);
        doc.text("Datos del Cliente", 10, y);
        y += lineHeight;
        doc.setFontSize(12);
        doc.text(`Nombre: ${venta.cliente.nombre}`, 10, y);
        y += lineHeight;
        doc.text(`Teléfono: ${venta.cliente.telefono}`, 10, y);
        if (venta.cliente.correo) {
          y += lineHeight;
          doc.text(`Correo: ${venta.cliente.correo}`, 10, y);
        }
        if (venta.cliente.direccion) {
          y += lineHeight;
          doc.text(`Dirección: ${venta.cliente.direccion}`, 10, y);
        }

        // Detalle de la Venta
        y += lineHeight * 1.5;
        doc.setFontSize(14);
        doc.text("Detalle de la Venta", 10, y);
        y += lineHeight;
        doc.setFontSize(12);
        venta.productos.forEach((prod, index) => {
          if (y > 270) {
            doc.addPage();
            y = 10;
          }
          doc.text(`${index + 1}. ${prod.producto_nombre} (${prod.producto_codigo})`, 10, y);
          y += lineHeight;
          doc.text(`   Cant: ${prod.cantidad} x Q${parseFloat(prod.precio_unitario || 0).toFixed(2)} = Q${parseFloat(prod.subtotal || 0).toFixed(2)}`, 10, y);
          y += lineHeight;
        });

        // Sumarios
        const fondoApertura = Number(datosApertura.montoApertura || 0);
        const ventaEfectivo = venta.metodo_pago.toLowerCase() === "efectivo" ? Number(venta.total || 0) : 0;
        const totalEfectivoSistema = fondoApertura + ventaEfectivo;
        const totalIngresado = venta.metodo_pago.toLowerCase() === "efectivo" ? Number(venta.total || 0) : Number(venta.total || 0);
        const diferencia = totalEfectivoSistema - totalIngresado;
        y += lineHeight * 1.5;
        doc.text(`VENTA TOTAL: Q${Number(venta.total || 0).toFixed(2)}`, 10, y);
        y += lineHeight;
        doc.text(`TOTAL EFECTIVO (Sistema): Q${totalEfectivoSistema.toFixed(2)}`, 10, y);
        y += lineHeight;
        doc.text(`TOTAL INGRESADO (Cajero): Q${totalIngresado.toFixed(2)}`, 10, y);
        y += lineHeight;
        doc.text(`DIFERENCIA: Q${diferencia.toFixed(2)}`, 10, y);
        y += lineHeight;
        doc.text(`Método de Pago: ${venta.metodo_pago}`, 10, y);
        if (venta.metodo_pago.toLowerCase() === "efectivo") {
          y += lineHeight;
          doc.text(`Cambio: Q${Number(venta.cambio || 0).toFixed(2)}`, 10, y);
        }
        doc.output("dataurlnewwindow");
      }

      // Apertura de Caja
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
        let idAperturaNum = nextAperturaId;
        let apertura = {
          idAperturaNum,
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
          Swal.fire("Caja Abierta", `Apertura registrada. Fondo: Q${montoApertura.toFixed(2)} (N° Apertura: ${idAperturaNum})`, "success");
        } catch (error) {
          Swal.fire("Error", error.message, "error");
        }
      }

      // Cierre de Caja (se asigna 0 a idAperturaNum si es undefined)
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
        let qVentas = query(
          collection(db, "ventas"),
          where("idApertura", "==", idAperturaActivo)
        );
        try {
          const snap = await getDocs(qVentas);
          let totalEfectivo = 0;
          let totalTarjeta = 0;
          let totalTransferencia = 0;
          let ventasDetalle = [];
          snap.forEach(docSnap => {
            let venta = docSnap.data();
            if (venta.metodo_pago?.toLowerCase() === "efectivo") {
              totalEfectivo += Number(venta.total || 0);
            } else if (venta.metodo_pago?.toLowerCase() === "tarjeta") {
              totalTarjeta += Number(venta.total || 0);
            } else if (venta.metodo_pago?.toLowerCase() === "transferencia") {
              totalTransferencia += Number(venta.total || 0);
            }
            ventasDetalle.push(venta);
          });
          let totalGeneral = totalEfectivo + totalTarjeta + totalTransferencia;
          const totalEfectivoSistema = Number(montoApertura) + totalEfectivo;
          const totalIngresado = montoFinal;
          const diferencia = totalEfectivoSistema - totalIngresado;
          let now = new Date();
          let horaCierre = now.toTimeString().split(" ")[0];
          let cierreData = {
            idAperturaNum: datosApertura.idAperturaNum || 0,
            fechaApertura: datosApertura.fechaApertura,
            horaApertura: datosApertura.horaApertura,
            fechaCierre: fechaHoy,
            horaCierre,
            montoApertura: datosApertura.montoApertura,
            totalEfectivo,
            totalTarjeta,
            totalTransferencia,
            totalGeneral,
            totalEfectivoSistema,
            totalIngresado,
            diferencia,
            usuario: usuarioActual
          };

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
                <strong>Num. Apertura:</strong> ${cierre.idAperturaNum}
              </div>
              <div class="col-md-3 summary-box">
                <strong>Cajero:</strong> ${cierre.usuario}
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
                <strong>Fondo Apertura:</strong> Q ${Number(cierre.montoApertura || 0).toFixed(2)}
              </div>
              <div class="col-md-4 summary-box bg-light">
                <strong>Venta Efectivo:</strong> Q ${Number(cierre.totalEfectivo || 0).toFixed(2)}
              </div>
              <div class="col-md-4 summary-box bg-light">
                <strong>VENTA TOTAL:</strong> Q ${Number(cierre.totalGeneral || 0).toFixed(2)}
              </div>
            </div>
            <div class="row mb-3">
              <div class="col-md-6 summary-box bg-light">
                <strong>TOTAL EFECTIVO (Sistema):</strong> Q ${Number(cierre.totalEfectivoSistema || 0).toFixed(2)}
              </div>
              <div class="col-md-6 summary-box bg-light">
                <strong>TOTAL INGRESADO (Cajero):</strong> Q ${Number(cierre.totalIngresado || 0).toFixed(2)}
              </div>
            </div>
            <div class="row mb-3">
              <div class="col-md-12 summary-box bg-light">
                <strong>DIFERENCIA:</strong> Q ${Number(cierre.diferencia || 0).toFixed(2)}
              </div>
            </div>
            <h4>Detalles de Operaciones</h4>
            <table class="table table-bordered">
              <thead>
                <tr>
                  <th>N° Documento</th>
                  <th>Forma de Pago</th>
                  <th>Monto Pagado</th>
                  <th>Empleado</th>
                </tr>
              </thead>
              <tbody>`;
        ventas.forEach((v, index) => {
          htmlReporte += `
                <tr>
                  <td>${v.idVenta || index + 1}</td>
                  <td>${v.metodo_pago || "-"}</td>
                  <td>Q ${Number(v.total || 0).toFixed(2)}</td>
                  <td>${v.empleadoNombre || "-"}</td>
                </tr>`;
        });
        htmlReporte += `
              </tbody>
            </table>
          </div>`;
        return htmlReporte;
      }

      // Cargar productos
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

      // Inicializar el sistema de ventas
      async function initSistemaVenta() {
        await loadProductos();
      }

      // Exponer funciones globalmente
      window.abrirCaja = abrirCaja;
      window.procesarVenta = procesarVenta;
      window.cerrarCaja = cerrarCaja;
      window.descargarComprobante = descargarComprobante;

      initSistemaVenta();
    </script>
  </body>
</html>
