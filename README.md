# Starches Builder

## Overview

Starches Builder is a command-line tool for processing cultural heritage and geospatial data into optimized search indexes and map layers for static websites. The tool transforms structured heritage asset data into efficient formats suitable for public-facing digital archives and heritage information systems.

## Purpose

This tool supports the publication of heritage asset databases by:

- Converting heritage records into searchable text indexes
- Generating optimized geospatial data layers for mapping applications
- Processing ontology definitions and data models for cultural heritage resources
- Building FlatGeobuf spatial indexes for efficient geographic querying
- Filtering and scoping data for public release

## Key Features

- **Text Search Indexing**: Generates Pagefind search indexes for full-text search capabilities
- **Geospatial Processing**: Creates FlatGeobuf format spatial data with R-tree indexing (Flatbush)
- **Data Model Support**: Processes Arches-compatible resource models and ontologies
- **Access Control**: Supports filtering private/sensitive records for public datasets
- **ETL Pipeline**: Extract, transform, and load heritage data from source systems
- **Multi-format Output**: Produces JSON, GeoJSON, and binary spatial formats

## Technical Specifications

**License**: AGPLv3
**Language**: TypeScript/Node.js
**Platform Support**: Linux (x64, ARM64), macOS (x64, ARM64), Windows (x64)
**Key Dependencies**:
- Alizarin (heritage data processing)
- Pagefind (search indexing)
- FlatGeobuf (geospatial encoding)

## Installation

```bash
npm install starches-builder
```

## Usage

### Initialize Project

```bash
starches-builder init [--dir <directory>]
```

Creates the required directory structure and configuration files for a new project.

### Build Search Indexes

```bash
starches-builder index \
  --definitions ./prebuild \
  --preindex ./prebuild/preindex \
  --site ./public
```

**Parameters**:
- `--definitions`: Location of ontology definitions and data models
- `--preindex`: Directory containing pre-processed index data
- `--site`: Output directory for generated public site assets

### Extract and Transform Data

```bash
starches-builder etl \
  --file <resource-file.json> \
  --prefix <resource-prefix>
```

**Parameters**:
- `--file`: Source JSON file containing heritage resource data
- `--prefix`: Namespace prefix for resource identifiers

## Output Structure

The tool generates:

```
public/
├── definitions/
│   ├── graphs/
│   │   ├── resource_models/     # Heritage asset data models
│   │   └── branches/             # Model extensions
│   ├── reference_data/
│   │   └── collections/          # Controlled vocabularies
│   └── business_data/            # Processed resource records
├── pagefind/                     # Search index files
└── fgb/                          # Geospatial data layers
```

## Data Privacy and Security

- Supports filtering of non-public records via scope configuration
- Implements nodegroup-level permissions for field visibility
- Excludes sensitive data models from public builds
- Validates publication status before including records

## Integration

Designed to integrate with:
- **Arches Platform**: Heritage inventory management system
- **Hugo Static Sites**: Via Alizarin theme framework
- **Web Mapping Libraries**: Through FlatGeobuf format support

## Repository

**GitHub**: https://github.com/flaxandteal/starches-builder
**Issues**: https://github.com/flaxandteal/starches-builder/issues

## Author

Phil Weir, Flax & Teal Limited
Email: phil.weir@flaxandteal.co.uk

## License Notice

This software is licensed under the GNU Affero General Public License v3.0 (AGPLv3). Organizations using this software to provide network services must make the complete source code available to users of those services.
