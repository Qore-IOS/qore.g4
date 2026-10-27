import {workspaceIdentity} from '../../workspace';
import {buildPermissionContext} from './permissions';
import type {PermissionContext} from './types';
/** There are no application sessions; AI uses the shared workspace scope. */
export async function permissionContextFromRequest(_req:Request):Promise<PermissionContext>{return buildPermissionContext({...workspaceIdentity,assignedLaboratories:[],primaryLaboratories:[],assignedDepots:[],assignedBrands:[],assignedLabGroups:[]});}
