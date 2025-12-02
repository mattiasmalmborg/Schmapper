#!/usr/bin/env python3
"""Test script to measure FHIR schema parsing performance"""
import time
import requests
import json

def test_fhir_parsing():
    url = 'http://localhost:8000/api/parse-xsd-schema'
    schema_path = r'C:\dev\Schmapper\Schemas\fhir_4.0.1.xsd'

    print(f"Reading schema file: {schema_path}")
    with open(schema_path, 'rb') as f:
        files = {'file': ('fhir_4.0.1.xsd', f, 'application/xml')}

        print("Sending request to backend...")
        start_time = time.time()

        try:
            response = requests.post(url, files=files, timeout=120)
            elapsed = time.time() - start_time

            print(f"\n{'='*60}")
            print(f"Request completed in {elapsed:.2f} seconds")
            print(f"Status code: {response.status_code}")
            print(f"{'='*60}\n")

            if response.status_code == 200:
                data = response.json()
                field_count = len(data.get('fields', []))
                repeating_count = len(data.get('repeating_elements', []))

                print(f"Schema name: {data.get('name', 'N/A')}")
                print(f"Schema type: {data.get('type', 'N/A')}")
                print(f"Total fields: {field_count}")
                print(f"Repeating elements: {repeating_count}")
                print(f"Response size: {len(response.content):,} bytes ({len(response.content)/1024/1024:.2f} MB)")

                # Sample first few fields
                if field_count > 0:
                    print(f"\nFirst 10 fields:")
                    for i, field in enumerate(data['fields'][:10]):
                        print(f"  {i+1}. {field.get('path', 'N/A')} ({field.get('type', 'N/A')})")

                # Save to file for analysis
                output_file = r'C:\dev\Schmapper\fhir_parse_result.json'
                with open(output_file, 'w', encoding='utf-8') as out:
                    json.dump(data, out, indent=2)
                print(f"\nFull result saved to: {output_file}")

            else:
                print(f"Error: {response.text[:500]}")

        except requests.Timeout:
            print("Request timed out after 120 seconds!")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == '__main__':
    test_fhir_parsing()
