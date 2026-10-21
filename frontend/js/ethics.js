/* Ajuste puntual de etiqueta, sin alterar la estructura ni los campos éticos. */
const renameEthicsHeading = () => document.querySelectorAll('summary').forEach(summary => { if (summary.textContent.trim() === 'Declaraciones éticas individuales') summary.textContent = 'Declaraciones éticas'; });
renameEthicsHeading();
new MutationObserver(renameEthicsHeading).observe(document.getElementById('app'), { childList: true, subtree: true });

