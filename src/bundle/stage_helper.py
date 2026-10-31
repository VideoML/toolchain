#!/usr/bin/env python3
"""FD-anchored private staging. No publication occurs without explicit commit."""
import base64
import ctypes
import errno
import hashlib
import json
import os
import re
import secrets
import select
import signal
import stat
import struct
import sys
import time
import unicodedata
import zlib
import zipfile

FILE_MAX=250*1024*1024;TOTAL_MAX=1024*1024*1024;COUNT_MAX=10000
READ_MAX=4*1024*1024;INPUT_MAX=65536;OUTPUT_MAX=8*1024*1024
IDLE_SECONDS=60;TOTAL_SECONDS=600
class Failure(Exception): pass

def fail(code,message): raise Failure(f'{code}: {message}')
def check_primitives():
    if sys.version_info<(3,9) or not all(hasattr(os,k) for k in ('O_DIRECTORY','O_NOFOLLOW','O_CLOEXEC','O_NONBLOCK','set_blocking','pread')) or os.scandir not in os.supports_fd or not all(f in os.supports_dir_fd for f in (os.open,os.mkdir,os.stat,os.unlink,os.rmdir)):
        fail('BUNDLE_CAPABILITY_UNAVAILABLE','FD-relative filesystem primitives unavailable')
    libc=ctypes.CDLL(None,use_errno=True)
    if sys.platform.startswith('linux'):
        fn=getattr(libc,'renameat2',None);flag=1
    elif sys.platform=='darwin':
        fn=getattr(libc,'renameatx_np',None);flag=4
    else: fn=None;flag=0
    if fn is None: fail('BUNDLE_CAPABILITY_UNAVAILABLE','atomic no-replace rename unavailable')
    fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];fn.restype=ctypes.c_int
    return fn,flag

def segment(value):
    if not value or value in ('.','..') or value!=unicodedata.normalize('NFC',value) or re.search(r'[\x00-\x1f\x7f-\x9f\\<>:"|?*]',value) or value.endswith(('.', ' ')) or re.match(r'^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)',value,re.I):
        fail('BUNDLE_PATH','invalid path segment')
    try: value.encode('utf-8','strict')
    except UnicodeError: fail('BUNDLE_PATH','invalid Unicode')
    return value

def path_parts(path):
    if not isinstance(path,str) or not path or path.startswith('/') or re.match(r'^[A-Za-z]:',path):fail('BUNDLE_PATH','invalid relative path')
    return [segment(part) for part in path.split('/')]

def absolute_parts(path):
    if not isinstance(path,str) or not path.startswith('/') or path=='/':fail('BUNDLE_PATH','absolute non-root path required')
    return path_parts(path[1:])

def open_absolute(path, trusted=False, forbidden=None):
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
    try:
        parts=absolute_parts(path)
        for index,part in enumerate(parts):
            previous=os.fstat(fd)
            if forbidden and same(previous,forbidden):fail('BUNDLE_PATH','destination nested within source')
            if trusted and (previous.st_uid not in (0,os.geteuid()) or ((previous.st_mode&0o022) and not (previous.st_uid==0 and previous.st_mode&stat.S_ISVTX))):fail('BUNDLE_TRUST','writable destination ancestor')
            next_fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd);os.close(fd);fd=next_fd
            current=os.fstat(fd)
            if forbidden and same(current,forbidden):fail('BUNDLE_PATH','destination nested within source')
            if trusted and index==len(parts)-1 and (current.st_uid!=os.geteuid() or current.st_mode&0o022):fail('BUNDLE_TRUST','publication parent must be private and owned')
        return fd
    except: os.close(fd);raise

def same(a,b):return (a.st_dev,a.st_ino)==(b.st_dev,b.st_ino)
def emit(value):
    text=json.dumps(value,ensure_ascii=False,separators=(',',':'))
    if len(text.encode('utf-8'))>OUTPUT_MAX:fail('BUNDLE_LIMIT','protocol response too large')
    print(text,flush=True)

def remove_tree(fd):
    for name in os.listdir(fd):
        st=os.stat(name,dir_fd=fd,follow_symlinks=False)
        if stat.S_ISDIR(st.st_mode):
            child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
            try:remove_tree(child)
            finally:os.close(child)
            os.rmdir(name,dir_fd=fd)
        else:os.unlink(name,dir_fd=fd)

def copy_tree(source,destination,deadline):
    inventory=[];count=0;total=0;folded={}
    def visit(src,dst,prefix,depth=0):
        nonlocal count,total
        if depth>128:fail('BUNDLE_LIMIT','directory depth')
        with os.scandir(src) as entries:
          for entry in entries:
            if time.monotonic()>=deadline:fail('BUNDLE_TIMEOUT','helper deadline')
            name=entry.name;segment(name);path=f'{prefix}/{name}' if prefix else name;key=path.casefold()
            count+=1
            if count>COUNT_MAX or len(path.encode('utf-8'))>4096:fail('BUNDLE_LIMIT','entry count or path length')
            if key in folded:fail('BUNDLE_PATH','case-fold collision')
            folded[key]=path
            before=os.stat(name,dir_fd=src,follow_symlinks=False)
            if stat.S_ISDIR(before.st_mode):
                child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=src)
                try:
                    if not same(before,os.fstat(child)):fail('BUNDLE_RACE','directory changed')
                    os.mkdir(name,0o700,dir_fd=dst);target=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=dst)
                    try:visit(child,target,path,depth+1)
                    finally:os.close(target)
                finally:os.close(child)
            elif stat.S_ISREG(before.st_mode):
                if before.st_size>FILE_MAX or before.st_nlink!=1:fail('BUNDLE_LIMIT','file size or hard link')
                file=os.open(name,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=src)
                try:
                    start=os.fstat(file)
                    if not same(before,start) or not stat.S_ISREG(start.st_mode) or start.st_nlink!=1:fail('BUNDLE_RACE','file changed')
                    out=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=dst)
                    digest=hashlib.sha256();size=0
                    try:
                        while True:
                            if time.monotonic()>=deadline:fail('BUNDLE_TIMEOUT','helper deadline')
                            data=os.read(file,1024*1024)
                            if not data:break
                            size+=len(data);total+=len(data)
                            if size>FILE_MAX or total>TOTAL_MAX:fail('BUNDLE_LIMIT','expanded bytes')
                            digest.update(data);view=memoryview(data)
                            while view:
                                wrote=os.write(out,view)
                                if wrote<=0:fail('BUNDLE_IO','short write')
                                view=view[wrote:]
                    finally:os.close(out)
                    end=os.fstat(file)
                    if size!=start.st_size or (start.st_size,start.st_mtime_ns,start.st_ctime_ns)!=(end.st_size,end.st_mtime_ns,end.st_ctime_ns):fail('BUNDLE_RACE','file mutated')
                    inventory.append({'path':path,'size':size,'sha256':digest.hexdigest()})
                finally:os.close(file)
            else:fail('BUNDLE_PATH','symlink or special file')
    visit(source,destination,'');return inventory

def capture_selected(source,destination,path,deadline,state):
    parts=path_parts(path)
    if len(parts)>128 or len(path.encode('utf-8'))>4096:fail('BUNDLE_LIMIT','selected path bounds')
    src=os.dup(source);dst=os.dup(destination)
    try:
        for index,part in enumerate(parts):
            prefix='/'.join(parts[:index+1]);key=prefix.casefold();prior=state['paths'].get(key)
            if prior is not None and prior!=prefix:fail('BUNDLE_PATH','case-fold collision')
            if prior is None:
                state['paths'][key]=prefix
                if len(state['paths'])>COUNT_MAX:fail('BUNDLE_LIMIT','selected path count')
            before=os.stat(part,dir_fd=src,follow_symlinks=False)
            if index<len(parts)-1:
                if not stat.S_ISDIR(before.st_mode):fail('BUNDLE_PATH','selected parent not directory')
                child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=src)
                if not same(before,os.fstat(child)):os.close(child);fail('BUNDLE_RACE','selected parent changed')
                os.close(src);src=child
                try:os.mkdir(part,0o700,dir_fd=dst)
                except FileExistsError:pass
                target=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=dst);os.close(dst);dst=target
                continue
            if path in state['files']:fail('BUNDLE_PATH','duplicate selected file')
            if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_size>FILE_MAX:fail('BUNDLE_PATH','selected file must be bounded and single-link regular')
            fd=os.open(part,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=src)
            try:
                start=os.fstat(fd)
                if not same(before,start) or not stat.S_ISREG(start.st_mode) or start.st_nlink!=1:fail('BUNDLE_RACE','selected file changed')
                out=os.open(part,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=dst);digest=hashlib.sha256();size=0
                try:
                    while True:
                        if time.monotonic()>=deadline:fail('BUNDLE_TIMEOUT','helper deadline')
                        data=os.read(fd,1024*1024)
                        if not data:break
                        size+=len(data);state['bytes']+=len(data)
                        if size>FILE_MAX or state['bytes']>TOTAL_MAX:fail('BUNDLE_LIMIT','selected bytes')
                        digest.update(data);view=memoryview(data)
                        while view:
                            written=os.write(out,view)
                            if written<=0:fail('BUNDLE_IO','short write')
                            view=view[written:]
                finally:os.close(out)
                end=os.fstat(fd)
                if size!=start.st_size or (start.st_size,start.st_mtime_ns,start.st_ctime_ns)!=(end.st_size,end.st_mtime_ns,end.st_ctime_ns):fail('BUNDLE_RACE','selected file mutated')
                result={'path':path,'size':size,'sha256':digest.hexdigest()};state['files'][path]=result;return result
            finally:os.close(fd)
    finally:os.close(src);os.close(dst)

def open_staged(root,path):
    parts=path_parts(path);parent=os.dup(root)
    try:
        for part in parts[:-1]:
            next_fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent);os.close(parent);parent=next_fd
        fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent);st=os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1:os.close(fd);fail('BUNDLE_PATH','nonregular staged file')
        return fd
    finally:os.close(parent)

def open_absolute_file(path):
    parts=absolute_parts(path);name=parts.pop()
    if not parts:fail('BUNDLE_PATH','archive parent cannot be root')
    parent=open_absolute('/'+'/'.join(parts))
    try:
        before=os.stat(name,dir_fd=parent,follow_symlinks=False)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1:fail('BUNDLE_PATH','archive must be a single-link regular file')
        fd=os.open(name,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
        actual=os.fstat(fd)
        if not same(before,actual) or not stat.S_ISREG(actual.st_mode) or actual.st_nlink!=1:
            os.close(fd);fail('BUNDLE_RACE','archive changed')
        return fd
    finally:os.close(parent)

def copy_zip(source,destination,deadline):
    original=os.fstat(source);archive_size=original.st_size
    if archive_size<22 or archive_size>FILE_MAX:fail('BUNDLE_ZIP','archive size')
    def read_at(offset,length):
        if offset<0 or length<0 or offset+length>archive_size:fail('BUNDLE_ZIP','truncated archive')
        data=os.pread(source,length,offset)
        if len(data)!=length:fail('BUNDLE_ZIP','short archive read')
        return data
    def extra_ok(data):
        i=0
        while i<len(data):
            if i+4>len(data):fail('BUNDLE_ZIP','truncated extra')
            kind,length=struct.unpack_from('<HH',data,i);i+=4
            if i+length>len(data) or kind not in (0x5455,0x7875):fail('BUNDLE_ZIP','unsupported extra')
            i+=length
    tail_size=min(archive_size,65557);tail=read_at(archive_size-tail_size,tail_size);eocd=-1
    for i in range(len(tail)-22,-1,-1):
        if tail[i:i+4]==b'PK\x05\x06' and i+22+struct.unpack_from('<H',tail,i+20)[0]==len(tail):eocd=i;break
    if eocd<0:fail('BUNDLE_ZIP','missing end record')
    _,disk,central_disk,disk_count,count,central_size,central_start,_=struct.unpack_from('<IHHHHIIH',tail,eocd)
    if disk or central_disk or disk_count!=count or count>COUNT_MAX or central_size>64*1024*1024 or central_start+central_size!=archive_size-tail_size+eocd:fail('BUNDLE_ZIP','unsupported central directory')
    central=read_at(central_start,central_size);offset=0;entries=[];paths={};total=0
    for _ in range(count):
        if offset+46>len(central) or central[offset:offset+4]!=b'PK\x01\x02':fail('BUNDLE_ZIP','invalid central entry')
        made,_,flags,method=struct.unpack_from('<HHHH',central,offset+4)
        crc,compressed,size=struct.unpack_from('<III',central,offset+16)
        name_len,extra_len,comment_len,disk_start=struct.unpack_from('<HHHH',central,offset+28)
        external,local=struct.unpack_from('<II',central,offset+38)
        end=offset+46+name_len+extra_len+comment_len
        if end>len(central) or disk_start or flags&~0x80e or method not in (0,8) or (method==0 and flags&6) or size>FILE_MAX or compressed>FILE_MAX or (method==0 and compressed!=size) or (method==8 and compressed==0):fail('BUNDLE_ZIP','unsupported entry')
        raw=central[offset+46:offset+46+name_len];extra_ok(central[offset+46+name_len:offset+46+name_len+extra_len])
        if len(raw)>4096 or (not flags&0x800 and any(b>=128 for b in raw)):fail('BUNDLE_ZIP','unsupported name encoding')
        try:name=raw.decode('utf-8','strict')
        except UnicodeError:fail('BUNDLE_ZIP','invalid UTF-8')
        directory=name.endswith('/');name=name[:-1] if directory else name;parts=path_parts(name)
        if len(parts)>128:fail('BUNDLE_LIMIT','archive depth')
        for i in range(1,len(parts)+1):
            prefix='/'.join(parts[:i]);key=prefix.casefold();existing=paths.get(key)
            if existing and existing[0]!=prefix:fail('BUNDLE_PATH','case-fold collision')
            is_dir=i<len(parts) or directory
            if existing and existing[1]!=is_dir:fail('BUNDLE_PATH','file/directory collision')
            if existing and i==len(parts) and existing[2]:fail('BUNDLE_PATH','duplicate archive entry')
            paths[key]=(prefix,is_dir,(i==len(parts)) or (existing[2] if existing else False))
        if len(paths)>COUNT_MAX:fail('BUNDLE_LIMIT','archive entry count')
        mode=(external>>16)&0xf000 if made>>8==3 else 0
        if mode not in (0,0x8000,0x4000) or (mode==0x4000)!=directory and mode:fail('BUNDLE_ZIP','special file or type mismatch')
        if directory and (size or crc):fail('BUNDLE_ZIP','directory data')
        total+=size
        if total>TOTAL_MAX:fail('BUNDLE_LIMIT','archive expanded bytes')
        local_header=read_at(local,30)
        if local_header[:4]!=b'PK\x03\x04' or struct.unpack_from('<H',local_header,6)[0]!=flags or struct.unpack_from('<H',local_header,8)[0]!=method:fail('BUNDLE_ZIP','local header mismatch')
        local_name_len,local_extra_len=struct.unpack_from('<HH',local_header,26)
        if local_name_len!=name_len or read_at(local+30,local_name_len)!=raw:fail('BUNDLE_ZIP','local name mismatch')
        extra_ok(read_at(local+30+local_name_len,local_extra_len));data=local+30+local_name_len+local_extra_len;data_end=data+compressed;end_data=data_end
        local_crc,local_comp,local_size=struct.unpack_from('<III',local_header,14)
        if data_end>central_start:fail('BUNDLE_ZIP','entry overlaps central directory')
        if flags&8:
            if (local_crc and local_crc!=crc) or (local_comp and local_comp!=compressed) or (local_size and local_size!=size):fail('BUNDLE_ZIP','descriptor header mismatch')
            signature=read_at(data_end,4)==b'PK\x07\x08';descriptor=read_at(data_end+(4 if signature else 0),12)
            if struct.unpack('<III',descriptor)!=(crc,compressed,size):fail('BUNDLE_ZIP','invalid descriptor')
            end_data+=16 if signature else 12
        elif (local_crc,local_comp,local_size)!=(crc,compressed,size):fail('BUNDLE_ZIP','size/CRC mismatch')
        if end_data>central_start:fail('BUNDLE_ZIP','entry beyond payload')
        entries.append((local,end_data,name,directory,method,data,compressed,size,crc));offset=end
    if offset!=len(central):fail('BUNDLE_ZIP','central trailing data')
    ordered=sorted(entries)
    if any(ordered[i][0]<ordered[i-1][1] for i in range(1,len(ordered))):fail('BUNDLE_ZIP','overlapping entries')
    inventory=[];observed=0
    def parent_for(parts):
        parent=os.dup(destination)
        try:
            for part in parts:
                try:os.mkdir(part,0o700,dir_fd=parent)
                except FileExistsError:pass
                child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent);os.close(parent);parent=child
            return parent
        except:os.close(parent);raise
    for _,_,name,directory,method,data,compressed,size,crc in entries:
        if time.monotonic()>=deadline:fail('BUNDLE_TIMEOUT','helper deadline')
        parts=path_parts(name);parent=parent_for(parts if directory else parts[:-1])
        out=-1 if directory else os.open(parts[-1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=parent);os.close(parent)
        digest=hashlib.sha256();actual=0;checksum=0;inflater=zlib.decompressobj(-15) if method==8 else None;cursor=0
        def write_chunk(chunk):
            nonlocal actual,observed,checksum
            if time.monotonic()>=deadline:fail('BUNDLE_TIMEOUT','helper deadline')
            actual+=len(chunk);observed+=len(chunk)
            if actual>size or actual>FILE_MAX or observed>TOTAL_MAX:fail('BUNDLE_LIMIT','archive expanded bytes')
            checksum=zlib.crc32(chunk,checksum);digest.update(chunk);view=memoryview(chunk)
            while view:
                if time.monotonic()>=deadline:fail('BUNDLE_TIMEOUT','helper deadline')
                n=os.write(out,view)
                if n<=0:fail('BUNDLE_IO','short ZIP write')
                view=view[n:]
        try:
            while cursor<compressed:
                if time.monotonic()>=deadline:fail('BUNDLE_TIMEOUT','helper deadline')
                chunk=read_at(data+cursor,min(1024*1024,compressed-cursor));cursor+=len(chunk)
                if inflater:
                    while chunk:
                        if time.monotonic()>=deadline:fail('BUNDLE_TIMEOUT','helper deadline')
                        part=inflater.decompress(chunk,1024*1024);chunk=inflater.unconsumed_tail;write_chunk(part)
                        if inflater.unused_data:fail('BUNDLE_ZIP','trailing compressed data')
                else:write_chunk(chunk)
            if inflater and (not inflater.eof or inflater.unused_data):fail('BUNDLE_ZIP','invalid compressed stream')
        except zlib.error as error:fail('BUNDLE_ZIP',f'invalid deflate stream: {error}')
        finally:
            if out>=0:os.close(out)
        if actual!=size or checksum&0xffffffff!=crc:fail('BUNDLE_ZIP','expanded size or CRC mismatch')
        if not directory:inventory.append({'path':name,'size':actual,'sha256':digest.hexdigest()})
    after=os.fstat(source)
    if (original.st_size,original.st_mtime_ns,original.st_ctime_ns)!=(after.st_size,after.st_mtime_ns,after.st_ctime_ns):fail('BUNDLE_RACE','archive mutated')
    return inventory

def serve(source_path,destination_path,source_kind='directory'):
    rename,flag=check_primitives();parts=absolute_parts(destination_path);name=parts.pop();parent_path='/'+ '/'.join(parts)
    if not parts:fail('BUNDLE_PATH','destination parent cannot be root')
    if source_kind not in ('directory','zip','selective'):fail('BUNDLE_PROTOCOL','invalid source type')
    source=open_absolute(source_path) if source_kind in ('directory','selective') else open_absolute_file(source_path)
    forbidden=os.fstat(source) if source_kind in ('directory','selective') else None
    parent=open_absolute(parent_path,trusted=True,forbidden=forbidden);stage_name='.videoml-stage-'+secrets.token_hex(16);stage=-1;created=False;published=False;terminal=None;archive_name=None;archive_fd=-1;archive_published=False
    try:
        os.mkdir(stage_name,0o700,dir_fd=parent);created=True;stage=os.open(stage_name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
        started=time.monotonic();selected={'files':{},'paths':{},'bytes':0};inventory=[] if source_kind=='selective' else (copy_tree if source_kind=='directory' else copy_zip)(source,stage,started+TOTAL_SECONDS);emit({'ok':True,'state':'prepared','files':inventory})
        stdin_fd=sys.stdin.fileno();os.set_blocking(stdin_fd,False);pending=bytearray();idle_deadline=time.monotonic()+IDLE_SECONDS
        while True:
            while b'\n' not in pending:
                remaining=min(idle_deadline-time.monotonic(),TOTAL_SECONDS-(time.monotonic()-started))
                if remaining<=0 or not select.select([stdin_fd],[],[],remaining)[0]:fail('BUNDLE_TIMEOUT','helper deadline')
                try:chunk=os.read(stdin_fd,INPUT_MAX+1-len(pending))
                except BlockingIOError:continue
                if not chunk:
                    if pending:fail('BUNDLE_PROTOCOL','partial request at EOF')
                    return
                pending.extend(chunk);idle_deadline=time.monotonic()+IDLE_SECONDS
                if len(pending)>INPUT_MAX:fail('BUNDLE_PROTOCOL','request too large')
            end=pending.index(b'\n');line=bytes(pending[:end+1]);del pending[:end+1];idle_deadline=time.monotonic()+IDLE_SECONDS
            request=json.loads(line);operation=request.get('operation') if isinstance(request,dict) else None
            if operation=='abort':terminal='aborted';break
            if operation=='capture':
                if source_kind!='selective':fail('BUNDLE_PROTOCOL','capture requires selective source')
                item=capture_selected(source,stage,request.get('path'),started+TOTAL_SECONDS,selected);inventory.append(item);emit({'ok':True,'file':item});continue
            if operation in ('read','read_range'):
                path=request.get('path');fd=open_staged(stage,path)
                try:
                    total_size=os.fstat(fd).st_size
                    offset=request.get('offset',0) if operation=='read_range' else 0
                    size=request.get('length') if operation=='read_range' else total_size
                    if type(offset) is not int or type(size) is not int or offset<0 or size<0 or size>READ_MAX or offset+size>total_size:fail('BUNDLE_LIMIT','semantic read range invalid')
                    os.lseek(fd,offset,os.SEEK_SET)
                    chunks=[];remaining=size
                    while remaining:
                        if time.monotonic()-started>=TOTAL_SECONDS:fail('BUNDLE_TIMEOUT','helper deadline')
                        data=os.read(fd,min(1024*1024,remaining))
                        if not data:fail('BUNDLE_IO','short staged read')
                        chunks.append(data);remaining-=len(data)
                    emit({'ok':True,'data':base64.b64encode(b''.join(chunks)).decode('ascii')})
                finally:os.close(fd)
            elif operation=='hash_range':
                path=request.get('path');start=request.get('offset');length=request.get('length')
                if type(start) is not int or type(length) is not int or start<0 or length<0 or length>FILE_MAX:fail('BUNDLE_PROTOCOL','invalid range')
                fd=open_staged(stage,path)
                try:
                    if start+length>os.fstat(fd).st_size:fail('BUNDLE_PROTOCOL','range beyond file')
                    os.lseek(fd,start,os.SEEK_SET);digest=hashlib.sha256();left=length
                    while left:
                        if time.monotonic()-started>=TOTAL_SECONDS:fail('BUNDLE_TIMEOUT','helper deadline')
                        data=os.read(fd,min(left,1024*1024))
                        if not data:fail('BUNDLE_IO','short range read')
                        digest.update(data);left-=len(data)
                    emit({'ok':True,'sha256':digest.hexdigest()})
                finally:os.close(fd)
            elif operation in ('commit','commit_zip'):
                try:current=open_absolute(parent_path,trusted=True,forbidden=forbidden)
                except OSError:fail('BUNDLE_RACE','destination parent inaccessible or replaced')
                try:
                    if not same(os.fstat(current),os.fstat(parent)):fail('BUNDLE_RACE','destination parent replaced')
                finally:os.close(current)
                try:stage_entry=os.stat(stage_name,dir_fd=parent,follow_symlinks=False)
                except OSError:fail('BUNDLE_RACE','stage path missing or replaced')
                if not stat.S_ISDIR(stage_entry.st_mode) or not same(stage_entry,os.fstat(stage)):fail('BUNDLE_RACE','stage path replaced')
                if operation=='commit_zip':
                    archive_name='.videoml-archive-'+secrets.token_hex(16)
                    archive_fd=os.open(archive_name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=parent)
                    with os.fdopen(os.dup(archive_fd),'wb') as stream:
                        with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED,allowZip64=False) as archive:
                            for item in sorted(inventory,key=lambda value:value['path']):
                                if time.monotonic()-started>=TOTAL_SECONDS:fail('BUNDLE_TIMEOUT','helper deadline')
                                fd=open_staged(stage,item['path']);digest=hashlib.sha256();remaining=item['size']
                                try:
                                    info=zipfile.ZipInfo(item['path'],(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=(stat.S_IFREG|0o600)<<16
                                    with archive.open(info,'w') as output:
                                        while remaining:
                                            if time.monotonic()-started>=TOTAL_SECONDS:fail('BUNDLE_TIMEOUT','helper deadline')
                                            data=os.read(fd,min(1024*1024,remaining))
                                            if not data:fail('BUNDLE_IO','short staged ZIP read')
                                            output.write(data);digest.update(data);remaining-=len(data)
                                            if stream.tell()>FILE_MAX:fail('BUNDLE_LIMIT','ZIP compressed size')
                                    if digest.hexdigest()!=item['sha256'] or os.read(fd,1):fail('BUNDLE_RACE','staged ZIP input changed')
                                finally:os.close(fd)
                        if stream.tell()>FILE_MAX:fail('BUNDLE_LIMIT','ZIP compressed size')
                    # Recheck the trusted parent and owned archive entry immediately before publication.
                    current=open_absolute(parent_path,trusted=True,forbidden=forbidden)
                    try:
                        if not same(os.fstat(current),os.fstat(parent)):fail('BUNDLE_RACE','destination parent replaced')
                    finally:os.close(current)
                    if not same(os.stat(archive_name,dir_fd=parent,follow_symlinks=False),os.fstat(archive_fd)):fail('BUNDLE_RACE','archive path replaced')
                publish_name=archive_name if operation=='commit_zip' else stage_name
                if rename(parent,os.fsencode(publish_name),parent,os.fsencode(name),flag)!=0:
                    error=ctypes.get_errno()
                    if error==errno.EEXIST:fail('BUNDLE_DESTINATION_EXISTS','destination exists')
                    if error in (errno.ENOSYS,errno.EINVAL,errno.ENOTSUP):fail('BUNDLE_CAPABILITY_UNAVAILABLE','no-replace rename unsupported')
                    raise OSError(error,os.strerror(error))
                if operation=='commit_zip':archive_published=True
                else:published=True
                terminal='committed';break
            else:fail('BUNDLE_PROTOCOL','unknown operation')
    finally:
        owned_name=False;cleanup_error=None
        try:
            if stage>=0 and not published:
                remove_tree(stage)
                try:owned_name=same(os.stat(stage_name,dir_fd=parent,follow_symlinks=False),os.fstat(stage))
                except OSError:owned_name=False
            if created and not published:
                if owned_name:os.rmdir(stage_name,dir_fd=parent)
                else:fail('BUNDLE_CLEANUP_UNCONFIRMED','stage name replaced or removed')
        except Exception as error:cleanup_error=error
        if archive_fd>=0:
            try:
                if not archive_published:
                    current=os.stat(archive_name,dir_fd=parent,follow_symlinks=False)
                    if not same(current,os.fstat(archive_fd)):fail('BUNDLE_CLEANUP_UNCONFIRMED','archive name replaced')
                    os.unlink(archive_name,dir_fd=parent)
            except Exception as error:cleanup_error=cleanup_error or error
        for fd in (archive_fd,stage,source,parent):
            if fd>=0:
                try:os.close(fd)
                except OSError as error:cleanup_error=cleanup_error or error
        if cleanup_error:fail('BUNDLE_CLEANUP_UNCONFIRMED',str(cleanup_error))
    if terminal:emit({'ok':True,'state':terminal})

if __name__=='__main__':
    try:
        def cancelled(_signal,_frame): fail('BUNDLE_CANCELLED','helper cancelled')
        signal.signal(signal.SIGTERM,cancelled)
        if len(sys.argv) not in (3,4):fail('BUNDLE_PROTOCOL','source, destination and optional kind required')
        serve(sys.argv[1],sys.argv[2],sys.argv[3] if len(sys.argv)==4 else 'directory')
    except Exception as error:
        if isinstance(error,Failure):message=str(error)
        elif isinstance(error,OSError) and error.errno in (errno.ELOOP,errno.ENOTDIR,errno.ENOENT):message=f'BUNDLE_PATH: {error}'
        elif isinstance(error,OSError):message=f'BUNDLE_IO: {error}'
        else:message=f'BUNDLE_PROTOCOL: {error}'
        try:emit({'ok':False,'error':message})
        except Exception:pass
        sys.exit(1 if 'BUNDLE_CLEANUP_UNCONFIRMED' in message else 0)
