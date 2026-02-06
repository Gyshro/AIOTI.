// ============================================================
// CONFIG
// ============================================================

const API_BASE = "https://jgeg9i0js1.execute-api.us-east-1.amazonaws.com";

// ============================================================
// ELEMENTOS
// ============================================================

const form = document.getElementById("loginForm");
const errorBox = document.getElementById("loginError");
const btn = form.querySelector("button");

// ============================================================
// HELPERS
// ============================================================

function showError(msg) {
  errorBox.innerText = msg;
  errorBox.style.display = "block";
}

function hideError() {
  errorBox.style.display = "none";
}

function setLoading(isLoading) {
  btn.disabled = isLoading;
  btn.innerText = isLoading ? "Entrando..." : "Entrar";
}

// ============================================================
// LOGIN
// ============================================================

async function login(username, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Erro ao autenticar");
  }

  return data.user;
}

// ============================================================
// SUBMIT
// ============================================================

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  if (!username || !password) {
    showError("Informe usuário e senha");
    return;
  }

  try {
    setLoading(true);

    const user = await login(username, password);

    // ======================================================
    // 🔐 CONTEXTO GLOBAL DO USUÁRIO (FINAL)
    // ======================================================

    const normalizedUser = {
      id: user.id,
      username: user.username,
      customer_id: user.customer_id,
      // 🔴 NORMALIZAÇÃO CRÍTICA
      is_superuser: user.is_superuser === true || user.is_superuser === 1
    };

    localStorage.setItem("user", JSON.stringify(normalizedUser));

    // ======================================================
    // REDIRECT
    // ======================================================

    window.location.href = "index.html";

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    showError("Usuário ou senha inválidos");
  } finally {
    setLoading(false);
  }
});

// ============================================================
// UX: ENTER FUNCIONA EM QUALQUER INPUT
// ============================================================

document.querySelectorAll("input").forEach(input => {
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      form.dispatchEvent(new Event("submit"));
    }
  });
});
