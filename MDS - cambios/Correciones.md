# Checklist de mejoras

- [x] **Validaciones y seguridad:** límites de caracteres, máximos y muchas validaciones en todos los campos, y protección contra inyección de SQL, código y comandos
- [X] **Ocultar términos técnicos:** quitar de la interfaz las palabras relacionadas con Postgres y SQL
- [X] **Reemplazar texto libre por opciones:** usar listas, desplegables o checkbox donde los datos son limitados (usuarios, roles, escuelas, modalidades con nombre en vez de número)
- [X] **Autocompletado y búsqueda:** al ingresar el nombre se carga la info (sin depender de la herramienta de autocompletado), búsqueda con LIKE, ORCID autocompletado por nombre y autocompletado con IA según el contexto y el tema
- [X] **Participantes nuevos:** permitir agregar uno que no esté en la base de datos, con aviso
- [X] **Presupuesto:** que funcione como tabla de cálculo y simplificar el proceso para que no tenga que ingresar tanta info
- [X] **Cambios sin guardar:** ventana de confirmación antes de salir de una pantalla
- [ ] **Orden de la interfaz (Parcial; rúbricas y catálogos ya ordenados, faltan los buckets y el texto de horas por semana):** organizar los buckets, los botones de editar/eliminar de rúbricas y catálogos, y el texto de horas por semana
- [X] **Estados de propuestas:** diferenciar entre propuestas cerradas y rechazadas
- [X] **Módulo de administrador:** para personalizar las calificaciones