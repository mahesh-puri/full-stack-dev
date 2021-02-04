if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./../../sw.js")
    .then((reg) => console.log("service worker registered"))
    .catch((err) => console.log("service worker not registered", err));
}

/*===== MENU SHOW Y HIDDEN =====*/
const navMenu = document.getElementById("nav-menu"),
  toggleMenu = document.getElementById("nav-toggle"),
  closeMenu = document.getElementById("nav-close");

// SHOW
toggleMenu.addEventListener("click", () => {
  navMenu.classList.toggle("show");
});

// HIDDEN
closeMenu.addEventListener("click", () => {
  navMenu.classList.remove("show");
});

/*===== ACTIVE AND REMOVE MENU =====*/
const navLink = document.querySelectorAll(".nav__link");

function linkAction() {
  navMenu.classList.remove("show");
}

navLink.forEach((n) => n.addEventListener("click", linkAction));

/*===== SCROLL SECTIONS ACTIVE LINK =====*/
const sections = document.querySelectorAll("section[id]");

window.addEventListener("scroll", scrollActive);

function scrollActive() {
  const scrollY = window.pageYOffset;

  sections.forEach((current) => {
    const sectionHeight = current.offsetHeight;
    const sectionTop = current.offsetTop - 50;
    sectionId = current.getAttribute("id");

    if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
      document
        .querySelector(".nav__menu a[href*=" + sectionId + "]")
        .classList.add("active");
    } else {
      document
        .querySelector(".nav__menu a[href*=" + sectionId + "]")
        .classList.remove("active");
    }
  });
}

var form = document.getElementsByTagName("form")[0];
form.addEventListener("submit", contact, false);
function contact(e) {
  // Prevent Default Form Submission
  e.preventDefault();

  var target = e.target || e.srcElement;
  var i = 0;
  var message = "";

  // Loop Through All Input Fields
  for (i = 0; i < target.length; ++i) {
    // Check to make sure it's a value. Don't need to include Buttons
    if (target[i].type != "text" && target[i].type != "textarea") {
      // Skip to next input since this one doesn't match our rules
      continue;
    }

    // Add Input Name and value followed by a line break
    message += target[i].name + ": " + target[i].value + "\r\n";
  }
  // Modify the hidden body input field that is required for the mailto: scheme
  target.elements["body"].value = message;

  // Submit the form since we previously stopped it. May cause recursive loop in some browsers? Should research this.
  this.submit();
}
