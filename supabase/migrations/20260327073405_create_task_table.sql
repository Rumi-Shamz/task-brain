create table task (
	id bigint generated always as identity primary key,
	title varchar not null,
	done boolean default false,
	created_at timestamptz default now()
);
