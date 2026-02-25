FROM perl:5.36-slim

WORKDIR /app

# Install system dependencies for Postgres driver
RUN apt-get update && apt-get install -y libpq-dev build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Perl dependencies
COPY cpanfile .
RUN cpanm --installdeps .

COPY . .

EXPOSE 8080
CMD ["morbo", "app.pl", "-l", "http://*:8080"]
