name: sgpi

services:
  db:
    image: postgres:18
    container_name: sgpi-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-sgpi}
      POSTGRES_USER: ${POSTGRES_USER:-sgpi}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-sgpi_dev}
    ports:
      - "5433:5432"
    volumes:
      - sgpi_pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10

  flyway:
    image: flyway/flyway:11
    container_name: sgpi-flyway
    depends_on:
      db:
        condition: service_healthy
    command: >
      -url=jdbc:postgresql://db:5432/${POSTGRES_DB:-sgpi}
      -user=${POSTGRES_USER:-sgpi}
      -password=${POSTGRES_PASSWORD:-sgpi_dev}
      -connectRetries=10
      migrate
    volumes:
      - "./Base de datos/Scripts:/flyway/sql:ro"

  backend:
    build: ./backend
    container_name: sgpi-backend
    restart: unless-stopped
    depends_on:
      flyway:
        condition: service_completed_successfully
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-sgpi}:${POSTGRES_PASSWORD:-sgpi_dev}@db:5432/${POSTGRES_DB:-sgpi}
    ports:
      - "3001:3000"

volumes:
  sgpi_pgdata: