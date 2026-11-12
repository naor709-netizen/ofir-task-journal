// מפתח הפתיח וסקריפט מוקדם ל-layout (מודול רגיל — לא "use client", כדי שהשרת יקבל את המחרוזת עצמה)
export const INTRO_KEY = "tj-intro-seen";
export const INTRO_SKIP_SCRIPT =
  `try{if(sessionStorage.getItem("${INTRO_KEY}"))document.documentElement.dataset.intro="skip"}catch(e){}`;
