/***************************************************
 * traslados.js (Firebase V9)
 * Muestra stock actual en la tienda de origen
 ***************************************************/
import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  addDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

// Variables globales
let products   = [];
let allStores  = [];

// Leer info del usuario
const loggedUser     = localStorage.getItem("loggedUser")     || "";
const loggedUserRole = localStorage.getItem("loggedUserRole") || "";
const loggedUserStore= localStorage.getItem("loggedUserStore")|| "";

/****************************************************
 * 1) Cargar TODAS las tiendas
 ****************************************************/
async function loadAllStores() {
  try {
    const q = query(collection(db, "tiendas"), orderBy("nombre"));
    const snapshot = await getDocs(q);
    allStores = [];
    snapshot.forEach((docSnap) => {
      const storeData = docSnap.data();
      allStores.push(storeData.nombre);
    });
  } catch (error) {
    console.error("Error loadAllStores:", error);
  }
}

/****************************************************
 * 2) Poblar <select> origin y destination (admin only)
 ****************************************************/
function populateOriginStoreSelect() {
  const storeSelect = document.getElementById("storeSelectOrigin");
  if (!storeSelect) return;
  storeSelect.innerHTML = `<option value="">Ver todos los traslados</option>`;
  allStores.forEach((storeName) => {
    const option = document.createElement("option");
    option.value = storeName;
    option.textContent = storeName;
    storeSelect.appendChild(option);
  });
}

function populateDestinationStoreSelect() {
  const storeSelect = document.getElementById("storeSelectDestination");
  if (!storeSelect) return;
  storeSelect.innerHTML = `<option value="">Ver todos los pendientes</option>`;
  allStores.forEach((storeName) => {
    const option = document.createElement("option");
    option.value = storeName;
    option.textContent = storeName;
    storeSelect.appendChild(option);
  });
}

/************************************************
 * 3) Cargar la lista global de productos
 ************************************************/
async function loadProductsGlobal() {
  try {
    const q = query(collection(db, "productos"), orderBy("codigo"));
    const snapshot = await getDocs(q);
    products = [];
    snapshot.forEach((docSnap) => {
      const prod = docSnap.data();
      prod.id = docSnap.id;
      products.push(prod);
    });
  } catch (error) {
    console.error("Error loading products:", error);
  }
}

/************************************************
 * 4) Llenar el <select> #transferProduct con products
 ************************************************/
function populateTransferProductSelect() {
  const select = document.getElementById("transferProduct");
  if (!select) return;
  select.innerHTML = "<option value=''>Seleccione producto</option>";
  products.forEach((prod) => {
    const option = document.createElement("option");
    option.value = prod.id;
    option.textContent = `${prod.codigo} - ${prod.descripcion}`;
    select.appendChild(option);
  });
}

/************************************************
 * 5) Actualizar stock actual al cambiar producto/origen
 ************************************************/
function updateStockDisplay() {
  const productId = document.getElementById("transferProduct")?.value || "";
  const originElem= document.getElementById("transferOrigin");
  const infoDiv   = document.getElementById("productStockInfo");
  if (!infoDiv) return;

  if (!productId || !originElem || !originElem.value) {
    // No mostrar nada si falta algo
    infoDiv.textContent = "";
    return;
  }
  const originStore = originElem.value;

  // Buscar en "products"
  const prod = products.find((p) => p.id === productId);
  if (!prod) {
    infoDiv.textContent = "Producto no encontrado";
    return;
  }

  // Determinar campo de stock
  let originStockField;
  if (originStore === "Tienda A") originStockField = "stockTiendaA";
  else if (originStore === "Tienda B") originStockField = "stockTiendaB";
  // Agrega más según tus tiendas

  let stockVal = 0;
  if (prod[originStockField] !== undefined) {
    stockVal = prod[originStockField];
  }
  infoDiv.textContent = `Stock actual en ${originStore}: ${stockVal}`;
}

/************************************************
 * 6) Cargar "Mis Traslados"
 ************************************************/
async function loadMyTransfers() {
  try {
    let qTraslados;
    const trasladosRef = collection(db, "traslados");

    if (loggedUserRole.toLowerCase() === "admin") {
      const storeSelected = document.getElementById("storeSelectOrigin")?.value || "";
      if (storeSelected) {
        qTraslados = query(
          trasladosRef,
          where("origin", "==", storeSelected),
          orderBy("date", "desc")
        );
      } else {
        qTraslados = query(trasladosRef, orderBy("date", "desc"));
      }
    } else {
      qTraslados = query(
        trasladosRef,
        where("pedidoPor", "==", loggedUser),
        orderBy("date", "desc")
      );
    }

    const snapshot = await getDocs(qTraslados);
    const tbody = document.querySelector("#myTransfersTable tbody");
    tbody.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const transfer = docSnap.data();
      const row = tbody.insertRow();

      row.insertCell(0).textContent = docSnap.id.substring(0, 6);

      const prod = products.find((p) => p.id === transfer.productId);
      row.insertCell(1).textContent = prod
        ? `${prod.codigo} - ${prod.descripcion}`
        : transfer.productId;

      row.insertCell(2).textContent = transfer.quantity;
      row.insertCell(3).textContent = transfer.origin;
      row.insertCell(4).textContent = transfer.destination;

      const dateStr = transfer.date && transfer.date.toDate
        ? transfer.date.toDate().toLocaleString()
        : "";
      row.insertCell(5).textContent = dateStr;

      row.insertCell(6).textContent = transfer.status
        ? transfer.status.toUpperCase()
        : "ACTIVO";

      const cellActions = row.insertCell(7);
      if (transfer.status === "pendiente") {
        cellActions.innerHTML = `
          <button class="btn btn-sm btn-primary me-1" onclick="editTransfer('${docSnap.id}')">Editar</button>
          <button class="btn btn-sm btn-warning me-1" onclick="annulTransfer('${docSnap.id}')">Anular</button>
          <button class="btn btn-sm btn-danger" onclick="deleteTransfer('${docSnap.id}')">Eliminar</button>
        `;
      } else {
        cellActions.textContent = "-";
      }
    });
  } catch (error) {
    console.error("Error loading my transfers:", error);
    Swal.fire("Error", "Error loading my transfers: " + error.message, "error");
  }
}

/***************************************************
 * 7) Cargar traslados pendientes (para validación)
 ***************************************************/
async function loadPendingTransfers() {
  try {
    let qPending;
    const trasladosRef = collection(db, "traslados");

    if (loggedUserRole.toLowerCase() === "admin") {
      const storeSelected = document.getElementById("storeSelectDestination")?.value || "";
      if (storeSelected) {
        qPending = query(
          trasladosRef,
          where("destination", "==", storeSelected),
          where("status", "==", "pendiente"),
          orderBy("date", "desc")
        );
      } else {
        qPending = query(
          trasladosRef,
          where("status", "==", "pendiente"),
          orderBy("date", "desc")
        );
      }
    } else {
      // No admin => "destination" = loggedUserStore
      qPending = query(
        trasladosRef,
        where("destination", "==", loggedUserStore),
        where("status", "==", "pendiente"),
        orderBy("date", "desc")
      );
    }

    const snapshot = await getDocs(qPending);
    const tbody = document.querySelector("#pendingTransfersTable tbody");
    tbody.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const transfer = docSnap.data();
      const row = tbody.insertRow();

      row.insertCell(0).textContent = docSnap.id.substring(0, 6);

      const dateStr = transfer.date && transfer.date.toDate
        ? transfer.date.toDate().toLocaleString()
        : "";
      row.insertCell(1).textContent = dateStr;

      const prod = products.find((p) => p.id === transfer.productId);
      row.insertCell(2).textContent = prod
        ? `${prod.codigo} - ${prod.descripcion}`
        : transfer.productId;

      row.insertCell(3).textContent = transfer.quantity;
      row.insertCell(4).textContent = transfer.pedidoPor || "-";

      let destStockField;
      if (transfer.destination === "Tienda A") destStockField = "stockTiendaA";
      else if (transfer.destination === "Tienda B") destStockField = "stockTiendaB";

      const currentStock =
        prod && prod[destStockField] !== undefined ? prod[destStockField] : "N/A";
      row.insertCell(5).textContent = currentStock;

      const cellActions = row.insertCell(6);
      cellActions.innerHTML = `
        <button class="btn btn-sm btn-info" onclick="showValidationDetail('${docSnap.id}')">Ver Detalles</button>
      `;
    });
  } catch (error) {
    console.error("Error loading pending transfers:", error);
    Swal.fire("Error", "Error loading pending transfers: " + error.message, "error");
  }
}

/********************************************************
 * 8) Mostrar detalle para validar un traslado pendiente
 ********************************************************/
async function showValidationDetail(transferId) {
  try {
    const transferRef = doc(db, "traslados", transferId);
    const transferSnap = await getDoc(transferRef);

    if (!transferSnap.exists()) {
      Swal.fire("Error", "Traslado no encontrado", "error");
      return;
    }
    const transfer = transferSnap.data();
    const prod = products.find((p) => p.id === transfer.productId);

    document.getElementById("detailId").textContent = transferId.substring(0, 6);
    document.getElementById("detailProduct").textContent = prod
      ? `${prod.codigo} - ${prod.descripcion}`
      : transfer.productId;
    document.getElementById("detailQuantity").textContent = transfer.quantity;
    document.getElementById("detailPedidoPor").textContent = transfer.pedidoPor || "-";

    let destStockField;
    if (transfer.destination === "Tienda A") destStockField = "stockTiendaA";
    else if (transfer.destination === "Tienda B") destStockField = "stockTiendaB";

    const currentStock =
      prod && prod[destStockField] !== undefined ? prod[destStockField] : "N/A";
    document.getElementById("detailStock").textContent = currentStock;

    document.getElementById("transferDetail").setAttribute("data-id", transferId);
    document.getElementById("transferDetail").style.display = "block";
  } catch (error) {
    console.error("Error showing validation detail:", error);
    Swal.fire("Error", "Error mostrando detalle: " + error.message, "error");
  }
}

/***********************************************************
 * 9) Validar (confirmar recepción) de un traslado pendiente
 ***********************************************************/
async function validateTransfer() {
  const detailDiv = document.getElementById("transferDetail");
  const transferId = detailDiv.getAttribute("data-id");
  if (!transferId) return;

  const confirmResult = await Swal.fire({
    title: "Confirmar Recepción",
    text: "¿Confirmas que has recibido físicamente los productos?",
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Pedido Recibido",
    cancelButtonText: "Cancelar"
  });
  if (!confirmResult.isConfirmed) return;

  try {
    const transferRef = doc(db, "traslados", transferId);
    const transferSnap = await getDoc(transferRef);
    if (!transferSnap.exists()) {
      Swal.fire("Error", "Traslado no encontrado", "error");
      return;
    }
    const transfer = transferSnap.data();

    const prodRef = doc(db, "productos", transfer.productId);
    await updateDoc(prodRef, {
      [transfer.destination === "Tienda A" ? "stockTiendaA" : "stockTiendaB"]:
        increment(transfer.quantity)
    });

    await updateDoc(transferRef, {
      status: "validado",
      dateValidation: serverTimestamp()
    });

    Swal.fire("Éxito", "Traslado validado y stock actualizado", "success");
    detailDiv.style.display = "none";

    loadMyTransfers();
    loadPendingTransfers();
  } catch (error) {
    console.error("Error validating transfer:", error);
    Swal.fire("Error", "Error validando traslado: " + error.message, "error");
  }
}

/***********************************************
 * 10) Mostrar formulario para crear un traslado
 ***********************************************/
async function showTransferForm() {
  document.getElementById("transferForm").reset();
  document.getElementById("transferId").value = "";
  document.getElementById("transferModalLabel").textContent = "Nuevo Traslado";

  // 1) Cargar/re-cargar productos globales
  await loadProductsGlobal();
  // 2) Poblar <select> #transferProduct
  populateTransferProductSelect();

  // 3) Configurar la tienda de origen
  await setOriginStore();

  // 4) Agregar listeners para mostrar stock cada vez que cambie el producto o la tienda
  const productSelect = document.getElementById("transferProduct");
  if (productSelect) {
    productSelect.addEventListener("change", updateStockDisplay);
  }
  const originElem = document.getElementById("transferOrigin");
  if (originElem && originElem.tagName === "SELECT") {
    originElem.addEventListener("change", updateStockDisplay);
  }

  new bootstrap.Modal(document.getElementById("transferModal")).show();
}

/***************************************************************
 * 11) Editar un traslado (cargar datos en el formulario)
 ***************************************************************/
async function editTransfer(transferId) {
  try {
    const transferRef = doc(db, "traslados", transferId);
    const transferSnap = await getDoc(transferRef);

    if (!transferSnap.exists()) {
      Swal.fire("Error", "Traslado no encontrado", "error");
      return;
    }
    const transfer = transferSnap.data();
    if (transfer.status !== "pendiente") {
      Swal.fire("Error", "Solo traslados pendientes se pueden editar", "error");
      return;
    }

    // 1) Cargar/re-cargar productos
    await loadProductsGlobal();
    // 2) Poblar <select> #transferProduct
    populateTransferProductSelect();

    // Llenar formulario
    document.getElementById("transferId").value      = transferId;
    document.getElementById("transferProduct").value = transfer.productId;
    document.getElementById("transferQuantity").value= transfer.quantity;

    await setOriginStore();
    if (transfer.origin) {
      populateDestinationSelect(transfer.origin);
    }
    document.getElementById("transferDestination").value = transfer.destination;
    document.getElementById("transferComments").value     = transfer.comments || "";
    document.getElementById("transferModalLabel").textContent = "Editar Traslado";

    // Ajustar la Origen
    const originElem = document.getElementById("transferOrigin");
    if (originElem && originElem.tagName === "SELECT") {
      originElem.value = transfer.origin;
    } else if (originElem && originElem.tagName === "INPUT") {
      originElem.value = transfer.origin;
    }

    // Listeners para mostrar stock
    const productSelect = document.getElementById("transferProduct");
    if (productSelect) {
      productSelect.addEventListener("change", updateStockDisplay);
    }
    if (originElem && originElem.tagName === "SELECT") {
      originElem.addEventListener("change", updateStockDisplay);
    }

    // Mostrar modal
    new bootstrap.Modal(document.getElementById("transferModal")).show();

    // Finalmente, mostrar el stock actual
    updateStockDisplay();
  } catch (error) {
    console.error("Error editing transfer:", error);
    Swal.fire("Error", "Error al editar traslado: " + error.message, "error");
  }
}

/*********************************************************
 * 12) Manejo del submit del formulario (crear/editar)
 *********************************************************/
document.getElementById("transferForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const transferId   = document.getElementById("transferId").value;
  const productId    = document.getElementById("transferProduct").value;
  const quantity     = parseFloat(document.getElementById("transferQuantity").value);

  const originElem   = document.getElementById("transferOrigin");
  const origin       = originElem ? originElem.value : "";
  const destination  = document.getElementById("transferDestination").value;
  const comments     = document.getElementById("transferComments").value;

  if (!productId || isNaN(quantity) || quantity <= 0 || !origin || !destination) {
    Swal.fire("Error", "Complete todos los campos correctamente.", "error");
    return;
  }
  if (origin === destination) {
    Swal.fire("Error", "La tienda de origen y destino deben ser distintas", "error");
    return;
  }

  const confirmResult = await Swal.fire({
    title: "Confirm Transfer",
    text: "¿Desea guardar este traslado?",
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Sí, guardar",
    cancelButtonText: "Cancelar"
  });
  if (!confirmResult.isConfirmed) return;

  try {
    const prod = products.find((p) => p.id === productId);
    if (!prod) {
      Swal.fire("Error", "Producto no encontrado", "error");
      return;
    }

    let originStockField;
    if (origin === "Tienda A") originStockField = "stockTiendaA";
    else if (origin === "Tienda B") originStockField = "stockTiendaB";

    const productRef = doc(db, "productos", productId);

    if (!transferId) {
      // Crear nuevo
      if (prod[originStockField] < quantity) {
        Swal.fire("Error", "Stock insuficiente en la tienda de origen", "error");
        return;
      }
      const pedidoPor = loggedUser || "unknown";

      // Descontar
      await updateDoc(productRef, {
        [originStockField]: prod[originStockField] - quantity
      });

      // Crear doc
      await addDoc(collection(db, "traslados"), {
        productId,
        quantity,
        origin,
        destination,
        comments,
        pedidoPor,
        date: serverTimestamp(),
        status: "pendiente"
      });
      Swal.fire("Éxito", "Traslado creado exitosamente", "success");
    } else {
      // Editar
      const oldTransferRef = doc(db, "traslados", transferId);
      const oldSnap        = await getDoc(oldTransferRef);
      if (!oldSnap.exists()) {
        Swal.fire("Error", "Traslado no encontrado", "error");
        return;
      }
      const oldTransfer = oldSnap.data();
      if (oldTransfer.status !== "pendiente") {
        Swal.fire("Error", "Solo traslados pendientes se pueden editar", "error");
        return;
      }

      // Revertir descuento anterior
      let oldOriginField;
      if (oldTransfer.origin === "Tienda A") oldOriginField = "stockTiendaA";
      else if (oldTransfer.origin === "Tienda B") oldOriginField = "stockTiendaB";

      const oldProductRef= doc(db, "productos", oldTransfer.productId);
      const oldProdSnap  = await getDoc(oldProductRef);
      const oldProdData  = oldProdSnap.data();

      await updateDoc(oldProductRef, {
        [oldOriginField]: oldProdData[oldOriginField] + oldTransfer.quantity
      });

      // Cambió el producto?
      if (oldTransfer.productId !== productId) {
        const newProdSnap = await getDoc(productRef);
        const newProdData = newProdSnap.data();
        if (newProdData[originStockField] < quantity) {
          Swal.fire("Error", "Stock insuficiente en la tienda origen para el nuevo producto", "error");
          return;
        }
        await updateDoc(productRef, {
          [originStockField]: newProdData[originStockField] - quantity
        });
      } else {
        // Mismo producto
        const currentProdSnap= await getDoc(productRef);
        const currentProd    = currentProdSnap.data();
        if (currentProd[originStockField] < quantity) {
          Swal.fire("Error", "Stock insuficiente en la tienda de origen", "error");
          return;
        }
        await updateDoc(productRef, {
          [originStockField]: currentProd[originStockField] - quantity
        });
      }

      // Actualizar el traslado
      await updateDoc(oldTransferRef, {
        productId,
        quantity,
        origin,
        destination,
        comments,
        date: serverTimestamp()
      });
      Swal.fire("Éxito", "Traslado actualizado exitosamente", "success");
    }

    bootstrap.Modal.getInstance(document.getElementById("transferModal")).hide();
    loadMyTransfers();
    loadPendingTransfers();
  } catch (error) {
    console.error("Error saving transfer:", error);
    Swal.fire("Error", "Error guardando traslado: " + error.message, "error");
  }
});

/***********************************************
 * 14) setOriginStore (admin => select, no admin => readOnly)
 ***********************************************/
async function setOriginStore() {
  try {
    let userData;
    const qUser = query(collection(db, "usuarios"), where("username", "==", loggedUser));
    const snapshot = await getDocs(qUser);
    snapshot.forEach((docSnap) => {
      userData = docSnap.data();
    });

    if (!userData) return;

    if (loggedUserRole.toLowerCase() === "admin") {
      let selectHtml = `
        <label for="transferOrigin" class="form-label">Tienda Origen</label>
        <select id="transferOrigin" class="form-select" required>
          <option value="">Seleccione tienda origen</option>
      `;
      allStores.forEach((storeName) => {
        selectHtml += `<option value="${storeName}">${storeName}</option>`;
      });
      selectHtml += "</select>";
      document.getElementById("originStoreContainer").innerHTML = selectHtml;

      const originSelect = document.getElementById("transferOrigin");
      originSelect.addEventListener("change", () => {
        populateDestinationSelect(originSelect.value);
        updateStockDisplay(); // Mostrar stock si ya hay producto seleccionado
      });
      populateDestinationSelect("");
    } else {
      const originHtml = `
        <label for="transferOrigin" class="form-label">Tienda Origen</label>
        <input type="text" id="transferOrigin" class="form-control"
               value="${userData.tienda}" readonly />
      `;
      document.getElementById("originStoreContainer").innerHTML = originHtml;
      populateDestinationSelect(userData.tienda);
    }
  } catch (error) {
    console.error("Error setting origin store:", error);
  }
}

/***************************************************
 * 15) Llenar <select> #transferDestination excluyendo Origen
 ***************************************************/
function populateDestinationSelect(originStoreValue) {
  const destSelect = document.getElementById("transferDestination");
  if (!destSelect) return;
  destSelect.innerHTML = `<option value="">Seleccione tienda destino</option>`;

  allStores.forEach((storeName) => {
    if (storeName !== originStoreValue) {
      const option = document.createElement("option");
      option.value = storeName;
      option.textContent = storeName;
      destSelect.appendChild(option);
    }
  });
}

/************************************************
 * 16) INICIALIZACIÓN AL CARGAR LA PÁGINA
 ************************************************/
document.addEventListener("DOMContentLoaded", async () => {
  // 1) Cargar todas las tiendas
  await loadAllStores();
  // 2) Cargar la lista global de productos (para ver nombres)
  await loadProductsGlobal();

  // 3) Cargar "Mis Traslados" y "Pendientes"
  loadMyTransfers();
  loadPendingTransfers();

  // Si es admin => mostrar combos de filtro
  if (loggedUserRole.toLowerCase() === "admin") {
    const adminOriginDiv = document.getElementById("adminStoreFilterOrigin");
    const adminDestDiv   = document.getElementById("adminStoreFilterDestination");
    if (adminOriginDiv) adminOriginDiv.style.display = "block";
    if (adminDestDiv)   adminDestDiv.style.display   = "block";

    populateOriginStoreSelect();
    populateDestinationStoreSelect();

    const storeSelectOrigin = document.getElementById("storeSelectOrigin");
    if (storeSelectOrigin) {
      storeSelectOrigin.addEventListener("change", () => {
        loadMyTransfers();
      });
    }
    const storeSelectDestination = document.getElementById("storeSelectDestination");
    if (storeSelectDestination) {
      storeSelectDestination.addEventListener("change", () => {
        loadPendingTransfers();
      });
    }
  }
});

// Exponer funciones al window si se usan en onclick
window.showTransferForm       = showTransferForm;
window.editTransfer           = editTransfer;
window.deleteTransfer         = deleteTransfer;
window.annulTransfer          = annulTransfer;
window.validateTransfer       = validateTransfer;
window.showValidationDetail   = showValidationDetail;

// Función que actualiza el stock actual en la interfaz
window.updateStockDisplay     = updateStockDisplay;
