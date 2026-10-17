// Google Analytics 4 (gtag.js).
// The Measurement ID lives only here. Copy it with the copy icon in
// Analytics > Admin > Data streams so a letter O is never typed as a zero.
(function () {
	var GA_ID = "G-BP0X5DDBRF";

	window.dataLayer = window.dataLayer || [];
	function gtag() {
		window.dataLayer.push(arguments);
	}
	window.gtag = gtag;

	gtag("js", new Date());
	gtag("config", GA_ID);

	var s = document.createElement("script");
	s.async = true;
	s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
	document.head.appendChild(s);
})();
