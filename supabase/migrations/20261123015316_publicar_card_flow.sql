update gkli_private.resources
set title = 'Flow',
    description = 'Acesse a mensageria de cobranças por e-mail e WhatsApp.',
    sort_order = 45,
    published = true
where code = 'flows';

update gkli_private.resources
set sort_order = 50
where code = 'relatorios';
