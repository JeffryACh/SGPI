-- 1) Estado actual de cada propuesta, para su líder (tipo trámite)
INSERT INTO public.notificaciones (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion, leida, fecha_lectura)
SELECT
  p.id_usuario_lider,
  p.id_propuesta,
  'tramite',
  'Estado de tu propuesta: ' || e.nombre_estado,
  p.titulo || ' · Estado actual: ' || e.nombre_estado || '.',
  COALESCE(
    (SELECT max(h.fecha_cambio) FROM public.proposal_state_history h WHERE h.id_propuesta = p.id_propuesta),
    p.fecha_creacion
  ),
  (e.nombre_estado = 'Cerrada'),
  CASE WHEN e.nombre_estado = 'Cerrada' THEN p.fecha_creacion + interval '1 day' END
FROM public.propuestas p
JOIN public.estados e ON e.id_estado = p.estado_actual;

-- 2) Aviso a los integrantes del equipo (que no son el líder)
INSERT INTO public.notificaciones (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion)
SELECT DISTINCT
  rt.id_usuario,
  p.id_propuesta,
  'seguimiento',
  'Participas en una propuesta',
  'Fuiste incluido/a en el equipo de «' || p.titulo || '».',
  p.fecha_creacion
FROM public.research_team rt
JOIN public.propuestas p ON p.id_propuesta = rt.id_propuesta
WHERE rt.id_usuario <> p.id_usuario_lider;

-- 3) Convocatoria vigente, para todos los investigadores
INSERT INTO public.notificaciones (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion)
SELECT
  ur.id_usuario,
  NULL,
  'convocatoria',
  'Fondos VIE 2027: fecha de sometimiento',
  'Recuerda que necesitas evaluación técnica y aval antes del 28 de septiembre.',
  TIMESTAMP '2026-08-20 08:00:00'
FROM public.user_roles ur
JOIN public.roles r ON r.id_rol = ur.id_rol
WHERE r.nombre_rol = 'Investigador';

-- 4) Bandeja de revisión: avisa a cada rol cuando hay propuestas en su etapa
INSERT INTO public.notificaciones (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion)
SELECT
  ur.id_usuario,
  p.id_propuesta,
  'tramite',
  'Expediente pendiente de revisión',
  '«' || p.titulo || '» espera tu revisión como ' || r.nombre_rol || '.',
  COALESCE(
    (SELECT max(h.fecha_cambio) FROM public.proposal_state_history h WHERE h.id_propuesta = p.id_propuesta),
    p.fecha_creacion
  )
FROM public.propuestas p
JOIN public.estados e ON e.id_estado = p.estado_actual
JOIN public.roles r ON (
     (r.nombre_rol = 'Vinculación'                AND e.nombre_estado ILIKE '%Vinculaci%')
  OR (r.nombre_rol = 'Comité Técnico'             AND e.nombre_estado ILIKE '%evaluaci%')
  OR (r.nombre_rol = 'Consejo de Escuela'         AND e.nombre_estado ILIKE '%aval%')
  OR (r.nombre_rol = 'Dirección de Investigación' AND e.nombre_estado ILIKE '%sometida%')
  OR (r.nombre_rol = 'CIE'                        AND e.nombre_estado ILIKE '%dictamin%')
)
JOIN public.user_roles ur ON ur.id_rol = r.id_rol;