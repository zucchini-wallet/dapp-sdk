#!/usr/bin/env python3
"""Run locally: passwords never enter arguments, environment variables or shell history."""
import argparse, getpass, subprocess
p=argparse.ArgumentParser(description='Export a testnet incoming viewing key from an encrypted Zucchini backup. This reveals incoming payments, but cannot spend.')
p.add_argument('--binary',required=True)
p.add_argument('--backup',required=True)
p.add_argument('--output',required=True)
a=p.parse_args()
password=getpass.getpass('Encrypted backup password (hidden): ')
subprocess.run([a.binary,a.backup,a.output],input=password.encode(),check=True)
