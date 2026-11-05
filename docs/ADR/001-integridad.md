# ADR · Registro atómico y resultados reservados

Se usa PostgreSQL como fuente de verdad. El voto adquiere bloqueo compartido sobre elección y ventana, cambia condicionalmente la participación y crea una papeleta sin identidad. El cierre adquiere bloqueo exclusivo siguiendo el mismo orden. Si INSERT falla, todo revierte.

La tabla de papeletas es append-only para el rol API; hay CHECK de tipo/lista y FK compuesta de lista/elección. No hay timestamps precisos, IP, sesión o alumno en esa tabla.

La publicación es un estado explícito posterior al cierre y conciliación. Los endpoints de preferencias revisan ese estado y el hash del acta. SSE solo transmite participación. No se considera suficiente ocultar información en React.

Consecuencia: pueden auditarse sumas y evitarse duplicados; no se garantiza anonimato resistente a un administrador hostil ni autenticidad criptográfica de extremo a extremo.
