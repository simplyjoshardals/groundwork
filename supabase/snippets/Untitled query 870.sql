select proname, pg_get_function_arguments(oid)
from pg_proc
where proname = 'reap_documents';